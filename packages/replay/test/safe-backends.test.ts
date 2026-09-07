import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@reprocore/format";
import { createOracleTemplate, evaluateOracle } from "@reprocore/oracles";
import {
  createDockerArguments,
  DockerCleanupError,
  evaluateFixtureWithDocker,
  runDoctor,
  runChildProcess,
  runDockerReplay,
  runLocalGeneratedFixture,
  safeWorkspacePath,
  sanitizeEnvironment,
  UnsafeDockerImageError,
  UnsafePathError,
  verifyDockerBaseline,
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

  it("passes explicit stdin to a child without inheriting the parent stream", async () => {
    const result = await runChildProcess(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      { input: "candidate fixture", timeoutMs: 5_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString("utf8")).toBe("candidate fixture");
  });

  it("terminates a child that exceeds the captured output limit", async () => {
    const result = await runChildProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('x'.repeat(4096));setTimeout(() => {}, 10000)",
      ],
      { outputLimitBytes: 128, timeoutMs: 5_000 },
    );
    expect(result.outputLimitExceeded).toBe(true);
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it("constructs a strongly isolated Docker invocation", () => {
    expect(
      createDockerArguments({
        image: `fixture-image@sha256:${"a".repeat(64)}`,
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
    expect(() =>
      createDockerArguments({
        image: "fixture-image:latest",
        command: ["test"],
        timeoutMs: 1_000,
      }),
    ).toThrow(UnsafeDockerImageError);
  });

  it("feeds an isolated custom-script result into Oracle evaluation", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      durationMs: 25,
      stdout: Buffer.from("checked"),
      stderr: Buffer.from("diagnostic"),
    });
    const result = await runDockerReplay(
      {
        image: `fixture-image@sha256:${"a".repeat(64)}`,
        command: ["oracle-check", "--case", "fixture"],
        stdin: "fixture-json\n",
        timeoutMs: 1_000,
      },
      execute,
    );
    const oracle = {
      ...createOracleTemplate("docker-custom-script"),
      rules: [
        {
          kind: "custom_script" as const,
          command: "oracle-check",
          args: ["--case", "fixture"],
        },
      ],
    };

    expect(evaluateOracle(oracle, result.observation).result).toBe(
      "INTERESTING",
    );
    expect(result.invocationHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.stdoutHash).toBe(sha256("checked"));
    expect(result.stderrHash).toBe(sha256("diagnostic"));
    expect(execute).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "--network=none",
        "--interactive",
        `fixture-image@sha256:${"a".repeat(64)}`,
      ]),
      { input: "fixture-json\n", timeoutMs: 1_000 },
    );

    execute.mockResolvedValueOnce({
      exitCode: 1,
      signal: "SIGKILL",
      timedOut: true,
      outputLimitExceeded: false,
      durationMs: 1_000,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
    const timedOut = await runDockerReplay(
      {
        image: `fixture-image@sha256:${"b".repeat(64)}`,
        command: ["oracle-check"],
        timeoutMs: 1_000,
      },
      execute,
    );
    expect(evaluateOracle(oracle, timedOut.observation).result).toBe(
      "UNRESOLVED",
    );
    expect(execute).toHaveBeenLastCalledWith(
      "docker",
      ["rm", "--force", expect.stringMatching(/^reprocore-/u)],
      { timeoutMs: 10_000 },
    );

    execute.mockResolvedValueOnce({
      exitCode: 1,
      signal: "SIGKILL",
      timedOut: false,
      outputLimitExceeded: true,
      durationMs: 50,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
    const outputLimited = await runDockerReplay(
      {
        image: `fixture-image@sha256:${"e".repeat(64)}`,
        command: ["oracle-check"],
        timeoutMs: 1_000,
      },
      execute,
    );
    expect(outputLimited.outputLimitExceeded).toBe(true);
    expect(evaluateOracle(oracle, outputLimited.observation).result).toBe(
      "UNRESOLVED",
    );
    expect(execute).toHaveBeenLastCalledWith(
      "docker",
      ["rm", "--force", expect.stringMatching(/^reprocore-/u)],
      { timeoutMs: 10_000 },
    );

    const failedCleanup = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: "SIGKILL",
        timedOut: true,
        outputLimitExceeded: false,
        durationMs: 1_000,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        outputLimitExceeded: false,
        durationMs: 10,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("cleanup failed"),
      });
    await expect(
      runDockerReplay(
        {
          image: `fixture-image@sha256:${"d".repeat(64)}`,
          command: ["oracle-check"],
          timeoutMs: 1_000,
        },
        failedCleanup,
      ),
    ).rejects.toBeInstanceOf(DockerCleanupError);
  });

  it("evaluates a custom Oracle against fixture JSON inside Docker", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
      durationMs: 10,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
    const fixture = {
      version: 1 as const,
      protocolVersion: "2026-07-28" as const,
      exchanges: [
        {
          request: { jsonrpc: "2.0" as const, id: 1, method: "tools/list" },
          response: { jsonrpc: "2.0" as const, id: 1, result: { tools: [] } },
        },
      ],
      files: {},
      observation: {},
    };
    const oracle = {
      ...createOracleTemplate("docker-stdin"),
      rules: [
        {
          kind: "custom_script" as const,
          command: "oracle-check",
          args: ["--stdin"],
        },
      ],
    };
    const options = {
      image: `fixture-image@sha256:${"c".repeat(64)}`,
      timeoutMs: 1_000,
    };

    const evaluation = await evaluateFixtureWithDocker(
      fixture,
      oracle,
      options,
      execute,
    );
    expect(evaluation.evaluation.result).toBe("INTERESTING");
    expect(JSON.parse(execute.mock.calls[0]![2].input)).toMatchObject({
      protocolVersion: "2026-07-28",
    });
    await expect(
      verifyDockerBaseline(fixture, oracle, options, 3, execute),
    ).resolves.toMatchObject({ status: "STABLE" });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("reports Docker absence as a warning while retaining local readiness", async () => {
    const report = await runDoctor("definitely-not-a-real-docker-command");
    expect(report.ready).toBe(true);
    expect(
      report.checks.find((check) => check.name === "docker-backend")?.status,
    ).toBe("warning");
  });
});
