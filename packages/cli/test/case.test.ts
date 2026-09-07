import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDeterministicMinCaseZip,
  InvalidMinCaseDirectoryError,
  sha256,
} from "@reprocore/format";
import type { OracleDocument } from "@reprocore/oracles";
import type { ReplayFixture } from "@reprocore/replay";
import { createMinCase, verifyMinCase } from "../src/case.js";

const cleanupPaths: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "reprocore-case-"));
  cleanupPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function inputs(): {
  fixture: ReplayFixture;
  oracle: OracleDocument;
  proof: unknown;
} {
  const fixture: ReplayFixture = {
    version: 1,
    protocolVersion: "2026-07-28",
    exchanges: [
      {
        request: {
          jsonrpc: "2.0",
          id: "write",
          method: "tools/call",
          params: {
            name: "write_file",
            arguments: { target: { path: "wrong.md" } },
          },
        },
        response: {
          jsonrpc: "2.0",
          id: "write",
          result: { structuredContent: { path: "wrong.md" } },
        },
      },
    ],
    files: { "fixtures/report.md": "wrong" },
    observation: { effects: ["wrong_target_written"] },
  };
  const oracle: OracleDocument = {
    version: 1,
    name: "portable-case",
    repeat: 3,
    mode: "all",
    timeoutMs: 10_000,
    rules: [
      { kind: "tool_called", tool: "write_file" },
      {
        kind: "file_hash",
        path: "fixtures/report.md",
        operator: "not_equals",
        expected: sha256("expected"),
      },
      { kind: "forbidden_effect", effect: "wrong_target_written" },
    ],
  };
  const proof = {
    version: 1,
    transaction: {
      originalCount: 40,
      finalCount: 1,
      minimality: "oneMinimal",
      ledger: [],
    },
    structure: {
      originalFieldCount: 20,
      finalFieldCount: 8,
      minimality: "oneMinimal",
      ledgers: [],
    },
  };
  return { fixture, oracle, proof };
}

describe("portable mincase packaging", () => {
  it("creates byte-identical ZIPs and a standalone 5/5 regression test", () => {
    const firstRoot = temporaryDirectory();
    const secondRoot = temporaryDirectory();
    const first = createMinCase({
      name: "portable-case",
      caseDirectory: join(firstRoot, "portable-case.mincase"),
      outputZip: join(firstRoot, "portable-case.mincase.zip"),
      ...inputs(),
    });
    const second = createMinCase({
      name: "portable-case",
      caseDirectory: join(secondRoot, "portable-case.mincase"),
      outputZip: join(secondRoot, "portable-case.mincase.zip"),
      ...inputs(),
    });

    expect(readFileSync(first.outputZip)).toEqual(
      readFileSync(second.outputZip),
    );
    expect(first.manifest.originalTransactionCount).toBe(40);
    expect(first.manifest.finalTransactionCount).toBe(1);
    expect(first.manifest.finalVerification).toEqual({ repeat: 5, passed: 5 });
    expect(verifyMinCase(first.caseDirectory)).toEqual(
      expect.objectContaining({ valid: true, repeat: 5, passed: 5 }),
    );

    const regression = spawnSync(
      process.execPath,
      ["--test", "runner/regression.test.mjs"],
      { cwd: first.caseDirectory, encoding: "utf8", windowsHide: true },
    );
    expect(regression.status, regression.stderr).toBe(0);

    writeFileSync(join(first.caseDirectory, "trace.jsonl"), "tampered\n");
    expect(() => verifyMinCase(first.caseDirectory)).toThrow(
      "Trace hash does not match manifest",
    );
  });

  it("refuses raw sessions and cache databases", () => {
    const root = temporaryDirectory();
    const created = createMinCase({
      name: "blocked-export",
      caseDirectory: join(root, "blocked-export.mincase"),
      outputZip: join(root, "blocked-export.mincase.zip"),
      ...inputs(),
    });
    writeFileSync(
      join(created.caseDirectory, "raw-frames.jsonl"),
      "sensitive\n",
    );
    expect(() =>
      createDeterministicMinCaseZip(
        created.caseDirectory,
        join(root, "should-not-exist.mincase.zip"),
      ),
    ).toThrow(InvalidMinCaseDirectoryError);
  });
});
