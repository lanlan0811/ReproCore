import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildCycloneDx,
  createChecksums,
  findPackageTarball,
} from "../scripts/release-metadata.mjs";
import {
  publishGiteeRelease,
  readGiteeConfiguration,
} from "../scripts/publish-gitee-release.mjs";

describe("release tooling", () => {
  it("uploads one traceable external-trial candidate from Linux CI", () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, "../.github/workflows/ci.yml"),
      "utf8",
    );
    expect(workflow).toContain("name: Upload external-trial candidate");
    expect(workflow).toContain("if: runner.os == 'Linux'");
    expect(workflow).toContain(
      "name: reprocore-${{ steps.candidate.outputs.version }}-candidate-${{ github.sha }}",
    );
    for (const artifact of [
      "release/reprocore-*.tgz",
      "release/reprocore-*.cdx.json",
      "release/SHA256SUMS",
    ]) {
      expect(workflow).toContain(artifact);
    }
    expect(workflow).toContain("if-no-files-found: error");
  });

  it("creates deterministic path-free CycloneDX metadata and checksums", () => {
    const sbom = buildCycloneDx(
      {
        MIT: [
          {
            name: "example",
            versions: ["2.0.0", "1.0.0"],
            paths: ["C:\\secret\\workspace"],
            homepage: "https://example.test",
          },
        ],
      },
      { name: "reprocore", version: "0.1.0", license: "AGPL-3.0-only" },
    );
    expect(JSON.stringify(sbom)).not.toContain("secret");
    expect(sbom.components.map((component) => component.version)).toEqual([
      "1.0.0",
      "2.0.0",
    ]);

    const directory = mkdtempSync(join(tmpdir(), "reprocore-release-test-"));
    try {
      writeFileSync(join(directory, "b.zip"), "b");
      writeFileSync(join(directory, "a.tgz"), "a");
      writeFileSync(join(directory, "SHA256SUMS"), "old");
      const checksums = createChecksums(directory);
      expect(checksums).toBe(
        [
          `${createHash("sha256").update("a").digest("hex")}  a.tgz`,
          `${createHash("sha256").update("b").digest("hex")}  b.zip`,
          "",
        ].join("\n"),
      );
      expect(() =>
        findPackageTarball(directory, { name: "reprocore", version: "0.1.0" }),
      ).toThrow(/Missing npm tarball/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails before contacting Gitee when configuration is incomplete", () => {
    expect(() => readGiteeConfiguration({ GITEE_OWNER: "owner" })).toThrow(
      /GITEE_ACCESS_TOKEN.*GITEE_REPO.*GIT_TAG.*RELEASE_DIRECTORY/u,
    );
  });

  it("creates a Gitee release and uploads every generated asset", async () => {
    const directory = mkdtempSync(join(tmpdir(), "reprocore-gitee-test-"));
    try {
      writeFileSync(join(directory, "artifact.tgz"), "artifact");
      writeFileSync(join(directory, "SHA256SUMS"), "digest");
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("not found", {
            status: 404,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 42 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ id: 1 }), {
              status: 201,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        );
      const result = await publishGiteeRelease(
        {
          GITEE_ACCESS_TOKEN: "test-token",
          GITEE_OWNER: "owner",
          GITEE_REPO: "repository",
          GIT_TAG: "v0.1.0",
          RELEASE_DIRECTORY: directory,
        },
        fetchMock,
      );
      expect(result).toEqual({
        id: 42,
        assets: ["SHA256SUMS", "artifact.tgz"],
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://gitee.com/api/v5/repos/owner/repository/releases/tags/v0.1.0",
      );
      expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual({
        Authorization: "Bearer test-token",
        Accept: "application/json",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resumes an existing Gitee release without duplicating assets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "reprocore-gitee-resume-"));
    try {
      writeFileSync(join(directory, "artifact.tgz"), "artifact");
      writeFileSync(join(directory, "SHA256SUMS"), "digest");
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 7, name: "artifact.tgz" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 2 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response("artifact", { status: 200 }));
      const result = await publishGiteeRelease(
        {
          GITEE_ACCESS_TOKEN: "test-token",
          GITEE_OWNER: "owner",
          GITEE_REPO: "repository",
          GIT_TAG: "v0.1.0",
          RELEASE_DIRECTORY: directory,
        },
        fetchMock,
      );
      expect(result.assets).toEqual(["SHA256SUMS", "artifact.tgz"]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[2]?.[0]).toMatch(/attach_files$/u);
      expect(fetchMock.mock.calls[3]?.[0]).toMatch(
        /attach_files\/7\/download$/u,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("replaces a same-named Gitee asset when its content differs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "reprocore-gitee-replace-"));
    try {
      writeFileSync(join(directory, "artifact.tgz"), "expected");
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 7, name: "artifact.tgz" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(new Response("stale", { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 8 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
        );
      await publishGiteeRelease(
        {
          GITEE_ACCESS_TOKEN: "test-token",
          GITEE_OWNER: "owner",
          GITEE_REPO: "repository",
          GIT_TAG: "v0.1.0",
          RELEASE_DIRECTORY: directory,
        },
        fetchMock,
      );

      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE");
      expect(fetchMock.mock.calls[4]?.[1]?.method).toBe("POST");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
