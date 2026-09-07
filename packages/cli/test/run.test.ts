import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "@reprocore/format";
import { writeOracleDocument, type OracleDocument } from "@reprocore/oracles";
import { EXIT_CODES } from "../src/index.js";
import { runCli, type CliIo } from "../src/run.js";

const cleanupPaths: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "reprocore-cli-"));
  cleanupPaths.push(path);
  return path;
}

function captureIo(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const output = (target: string[]) =>
    new Writable({
      write(chunk, _encoding, callback) {
        target.push(chunk.toString());
        callback();
      },
    });
  return {
    io: { stdout: output(stdout), stderr: output(stderr) },
    stdout,
    stderr,
  };
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("CLI safety boundary", () => {
  it("blocks pack before reading inputs when export was not confirmed", async () => {
    const captured = captureIo();
    const exitCode = await runCli(
      [
        "pack",
        "--fixture",
        "missing.json",
        "--oracle",
        "missing.yaml",
        "--proof",
        "missing-proof.json",
        "--out",
        "blocked.mincase.zip",
      ],
      captured.io,
    );

    expect(exitCode).toBe(EXIT_CODES.safetyBlocked);
    expect(captured.stderr.join("")).toContain("--confirm-export");
  });

  it("redacts secrets, verifies replay, and creates a confirmed package", async () => {
    const root = temporaryDirectory();
    const secret = "github_pat_abcdefghijklmnopqrstuvwxyz";
    const fixturePath = join(root, "fixture.json");
    const oraclePath = join(root, "oracle.yaml");
    const proofPath = join(root, "proof.json");
    const outputPath = join(root, "safe-case.mincase.zip");
    writeFileSync(
      fixturePath,
      JSON.stringify({
        version: 1,
        protocolVersion: "2026-07-28",
        exchanges: [
          {
            request: {
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: "write_file", arguments: { apiKey: secret } },
            },
            response: { jsonrpc: "2.0", id: 1, result: { ok: false } },
          },
        ],
        files: {},
        observation: { effects: ["wrong_target_written"] },
      }),
    );
    const oracle: OracleDocument = {
      version: 1,
      name: "safe-case",
      repeat: 3,
      mode: "all",
      timeoutMs: 10_000,
      rules: [{ kind: "tool_called", tool: "write_file" }],
    };
    writeOracleDocument(oraclePath, oracle);
    writeFileSync(
      proofPath,
      JSON.stringify({
        version: 1,
        transaction: {
          originalCount: 8,
          finalCount: 1,
          minimality: "oneMinimal",
          ledger: [],
        },
        structure: {
          originalFieldCount: 12,
          finalFieldCount: 5,
          minimality: "oneMinimal",
          ledgers: [],
        },
      }),
    );
    const captured = captureIo();
    const exitCode = await runCli(
      [
        "pack",
        "--fixture",
        fixturePath,
        "--oracle",
        oraclePath,
        "--proof",
        proofPath,
        "--out",
        outputPath,
        "--confirm-export",
        "--json",
      ],
      captured.io,
    );

    expect(exitCode).toBe(EXIT_CODES.success);
    const caseDirectory = join(root, "safe-case.mincase");
    const exportedFixture = readFileSync(
      join(caseDirectory, "fixtures", "replay.json"),
      "utf8",
    );
    expect(exportedFixture).not.toContain(secret);
    expect(exportedFixture).toContain("<REDACTED_SENSITIVE_FIELD_1>");
    expect(
      readFileSync(join(caseDirectory, "manifest.yaml"), "utf8"),
    ).toContain("redactionVerified: true");
    expect(readFileSync(outputPath).length).toBeGreaterThan(0);
    expect(sha256(exportedFixture)).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const reportPath = join(caseDirectory, "report.html");
    writeFileSync(reportPath, "stale");
    const reportExitCode = await runCli(
      ["report", "--case", caseDirectory, "--json"],
      captured.io,
    );
    expect(reportExitCode).toBe(EXIT_CODES.success);
    expect(readFileSync(reportPath, "utf8")).toContain("default-src 'none'");

    const verifyExitCode = await runCli(
      ["verify", "--case", caseDirectory, "--json"],
      captured.io,
    );
    expect(verifyExitCode).toBe(EXIT_CODES.success);

    writeFileSync(join(caseDirectory, "fixtures", "replay.json"), "{}\n");
    const tamperedIo = captureIo();
    const tamperedExitCode = await runCli(
      ["verify", "--case", caseDirectory, "--json"],
      tamperedIo.io,
    );
    expect(tamperedExitCode).toBe(EXIT_CODES.unresolved);
    expect(JSON.parse(tamperedIo.stderr.join(""))).toMatchObject({
      exitCode: EXIT_CODES.unresolved,
      safetyBlocked: false,
    });
  });

  it("returns the safety-blocked exit code for a risky attachment", async () => {
    const root = temporaryDirectory();
    const attachment = join(root, "capture.bin");
    writeFileSync(attachment, Buffer.from([0, 1, 2]));
    const captured = captureIo();

    const exitCode = await runCli(
      ["redact", "--check", attachment, "--json"],
      captured.io,
    );

    expect(exitCode).toBe(EXIT_CODES.safetyBlocked);
    expect(captured.stdout.join("")).toContain("unscanned_attachment");
  });

  it("distinguishes usage errors from runtime execution failures", async () => {
    const usageIo = captureIo();
    const usageExitCode = await runCli(
      ["verify", "--case", "missing.mincase", "--repeat", "0", "--json"],
      usageIo.io,
    );
    expect(usageExitCode).toBe(EXIT_CODES.usage);
    expect(JSON.parse(usageIo.stderr.join(""))).toMatchObject({
      exitCode: EXIT_CODES.usage,
      safetyBlocked: false,
    });

    const executionIo = captureIo();
    const executionExitCode = await runCli(
      ["verify", "--case", "missing.mincase", "--json"],
      executionIo.io,
    );
    expect(executionExitCode).toBe(EXIT_CODES.executionFailure);
    expect(JSON.parse(executionIo.stderr.join(""))).toMatchObject({
      exitCode: EXIT_CODES.executionFailure,
      safetyBlocked: false,
    });

    const unknownIo = captureIo();
    const unknownExitCode = await runCli(["unknown", "--json"], unknownIo.io);
    expect(unknownExitCode).toBe(EXIT_CODES.usage);
    expect(JSON.parse(unknownIo.stderr.join(""))).toMatchObject({
      exitCode: EXIT_CODES.usage,
    });
  });

  it("rejects an imported case with an unexpected top-level file", async () => {
    const root = temporaryDirectory();
    const caseDirectory = join(root, "unsafe.mincase");
    mkdirSync(caseDirectory);
    writeFileSync(join(caseDirectory, "unexpected.txt"), "unexpected");
    const captured = captureIo();

    const exitCode = await runCli(
      ["verify", "--case", caseDirectory, "--json"],
      captured.io,
    );

    expect(exitCode).toBe(EXIT_CODES.usage);
    expect(JSON.parse(captured.stderr.join(""))).toMatchObject({
      exitCode: EXIT_CODES.usage,
      safetyBlocked: false,
    });
  });
});
