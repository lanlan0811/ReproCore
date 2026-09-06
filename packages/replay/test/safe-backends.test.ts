import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "@reprocore/format";
import {
  createDockerArguments,
  runDoctor,
  runLocalGeneratedFixture,
  safeWorkspacePath,
  sanitizeEnvironment,
  UnsafePathError,
} from "../src/index.js";

const cleanupPaths: string[] = [];

function temporaryDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("safe replay backends", () => {
  it("runs generated actions in a disposable workspace", async () => {
    const before = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("reprocore-replay-"),
    );
    const result = await runLocalGeneratedFixture(
      {
        version: 1,
        files: { "fixtures/report.md": "before" },
        actions: [
          { kind: "write_file", path: "output/result.md", content: "after" },
          { kind: "exit", code: 7 },
        ],
      },
      { timeoutMs: 5_000 },
    );
    const after = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("reprocore-replay-"),
    );

    expect(result.observation.exitCode).toBe(7);
    expect(result.observation.fileHashes?.["output/result.md"]).toBe(
      sha256("after"),
    );
    expect(after).toEqual(before);
  });

  it("kills a generated runner when its budget expires", async () => {
    const result = await runLocalGeneratedFixture(
      {
        version: 1,
        files: {},
        actions: [{ kind: "delay", milliseconds: 10_000 }],
      },
      { timeoutMs: 100 },
    );
    expect(result.observation.timedOut).toBe(true);
    expect(result.observation.durationMs).toBeLessThan(5_000);
  });

  it("rejects absolute, traversal, and symbolic-link escapes", () => {
    const root = temporaryDirectory("reprocore-safe-root-");
    expect(() => safeWorkspacePath(root, "../outside")).toThrow(
      UnsafePathError,
    );
    expect(() => safeWorkspacePath(root, "C:\\outside.txt")).toThrow(
      UnsafePathError,
    );

    const outside = temporaryDirectory("reprocore-safe-outside-");
    const link = join(root, "link");
    mkdirSync(outside, { recursive: true });
    symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => safeWorkspacePath(root, "link/file.txt")).toThrow(
      UnsafePathError,
    );
  });

  it("passes only allowlisted environment variables", () => {
    expect(
      sanitizeEnvironment({ PATH: "safe", REPROCORE_TEST_SECRET: "blocked" }, [
        "PATH",
      ]),
    ).toEqual({ PATH: "safe" });
  });

  it("constructs a strongly isolated Docker invocation", () => {
    expect(
      createDockerArguments({
        image: "fixture-image",
        command: ["test"],
        timeoutMs: 1_000,
      }),
    ).toEqual(
      expect.arrayContaining([
        "--network=none",
        "--user=65532:65532",
        "--read-only",
        "--cpus=1",
        "--memory=512m",
        "--pids-limit=64",
      ]),
    );
  });

  it("reports Docker absence as a warning while retaining local readiness", async () => {
    const report = await runDoctor("definitely-not-a-real-docker-command");
    expect(report.ready).toBe(true);
    expect(
      report.checks.find((check) => check.name === "docker-backend")?.status,
    ).toBe("warning");
  });
});
