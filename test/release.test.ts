import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
          new Response(JSON.stringify([{ name: "artifact.tgz" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 2 }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }),
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
      expect(result.assets).toEqual(["SHA256SUMS", "artifact.tgz"]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2]?.[0]).toMatch(/attach_files$/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
