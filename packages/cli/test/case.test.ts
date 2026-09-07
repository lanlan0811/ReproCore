import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
import type { RedactionProof } from "@reprocore/redaction";
import { createMinCase, verifyMinCase } from "../src/case.js";
import { SafetyBlockedError } from "../src/index.js";

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
  redaction: RedactionProof;
  exportConfirmed: boolean;
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
  return {
    fixture,
    oracle,
    proof,
    redaction: {
      version: 1,
      passes: 2,
      verified: true,
      replayVerified: false,
      findings: [],
      substitutions: [],
    },
    exportConfirmed: true,
  };
}

describe("portable mincase packaging", () => {
  it("refuses to create any files without explicit export confirmation", () => {
    const root = temporaryDirectory();
    expect(() =>
      createMinCase({
        name: "unconfirmed",
        caseDirectory: join(root, "unconfirmed.mincase"),
        outputZip: join(root, "unconfirmed.mincase.zip"),
        ...inputs(),
        exportConfirmed: false,
      }),
    ).toThrow(SafetyBlockedError);
    expect(() => readFileSync(join(root, "unconfirmed.mincase.zip"))).toThrow();
  });

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
    expect(first.manifest.redactionVerified).toBe(true);
    expect(first.manifest.exportConfirmed).toBe(true);
    expect(
      readFileSync(join(first.caseDirectory, "report.html"), "utf8"),
    ).toContain("default-src 'none'");
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

  it("preserves supported JSON Schema Oracle semantics in the standalone runner", () => {
    const root = temporaryDirectory();
    const options = inputs();
    options.fixture.exchanges[0]!.response = {
      jsonrpc: "2.0",
      id: "write",
      result: { label: "bad", count: 3, items: [1, 1] },
    };
    const resultSchema = (schema: Record<string, unknown>) => ({
      type: "object",
      required: ["result"],
      properties: { result: schema },
    });
    options.oracle = {
      version: 1,
      name: "composed-schema",
      repeat: 3,
      mode: "all",
      timeoutMs: 10_000,
      rules: [
        {
          kind: "json_pointer",
          pointer: "/result",
          operator: "equals",
          value: { items: [1, 1], count: 3, label: "bad" },
        },
        {
          kind: "json_schema_invalid",
          schema: {
            oneOf: [
              {
                type: "object",
                required: ["jsonrpc"],
                properties: { jsonrpc: { const: "2.0" } },
              },
              {
                type: "object",
                required: ["id"],
                properties: { id: { enum: ["write"] } },
              },
            ],
          },
        },
        {
          kind: "json_schema_invalid",
          schema: resultSchema({
            type: "object",
            required: ["label"],
            properties: {
              label: { type: "string", minLength: 4, pattern: "^valid" },
            },
          }),
        },
        {
          kind: "json_schema_invalid",
          schema: resultSchema({
            type: "object",
            required: ["count"],
            properties: {
              count: { type: "integer", minimum: 4, multipleOf: 2 },
            },
          }),
        },
        {
          kind: "json_schema_invalid",
          schema: resultSchema({
            type: "object",
            required: ["items"],
            properties: {
              items: { type: "array", minItems: 2, uniqueItems: true },
            },
          }),
        },
        {
          kind: "json_schema_invalid",
          schema: resultSchema({
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                contains: { const: 1 },
                minContains: 3,
              },
            },
          }),
        },
        {
          kind: "json_schema_invalid",
          schema: resultSchema({
            type: "object",
            required: ["label"],
            properties: { label: {} },
            dependentRequired: { label: ["missing"] },
          }),
        },
        {
          kind: "json_schema_invalid",
          schema: resultSchema({
            type: "object",
            if: {
              type: "object",
              required: ["label"],
              properties: { label: { const: "bad" } },
            },
            then: {
              type: "object",
              required: ["missing"],
              properties: { missing: {} },
            },
          }),
        },
      ],
    };
    const created = createMinCase({
      name: "composed-schema",
      caseDirectory: join(root, "composed-schema.mincase"),
      outputZip: join(root, "composed-schema.mincase.zip"),
      ...options,
    });

    expect(created.manifest.caseType).toBe("executable");
    const regression = spawnSync(
      process.execPath,
      ["--test", "runner/regression.test.mjs"],
      { cwd: created.caseDirectory, encoding: "utf8", windowsHide: true },
    );
    expect(regression.status, regression.stderr).toBe(0);
  });

  it("marks a referenced Schema as explanatory", () => {
    const root = temporaryDirectory();
    const options = inputs();
    options.oracle = {
      version: 1,
      name: "unsupported-standalone-schema",
      repeat: 3,
      mode: "all",
      timeoutMs: 10_000,
      rules: [
        {
          kind: "json_schema_invalid",
          schema: {
            $ref: "#/$defs/expected",
            $defs: { expected: { type: "string" } },
          },
        },
      ],
    };
    const created = createMinCase({
      name: "unsupported-schema",
      caseDirectory: join(root, "unsupported-schema.mincase"),
      outputZip: join(root, "unsupported-schema.mincase.zip"),
      ...options,
    });

    expect(created.manifest.caseType).toBe("explanatory");
    expect(
      JSON.parse(
        readFileSync(join(created.caseDirectory, "provenance.json"), "utf8"),
      ),
    ).toMatchObject({ standaloneRegressionCompatible: false });
  });

  it("refuses missing files and unknown entries at every directory level", () => {
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
    expect(() => verifyMinCase(created.caseDirectory)).toThrow(
      InvalidMinCaseDirectoryError,
    );

    rmSync(join(created.caseDirectory, "raw-frames.jsonl"));
    writeFileSync(join(created.caseDirectory, "fixtures", "cache.sqlite"), "");
    expect(() => verifyMinCase(created.caseDirectory)).toThrow(
      InvalidMinCaseDirectoryError,
    );

    rmSync(join(created.caseDirectory, "fixtures", "cache.sqlite"));
    writeFileSync(join(created.caseDirectory, "unexpected.txt"), "unexpected");
    expect(() => verifyMinCase(created.caseDirectory)).toThrow(
      InvalidMinCaseDirectoryError,
    );

    rmSync(join(created.caseDirectory, "unexpected.txt"));
    writeFileSync(
      join(created.caseDirectory, "runner", "unexpected.txt"),
      "unexpected",
    );
    expect(() => verifyMinCase(created.caseDirectory)).toThrow(
      InvalidMinCaseDirectoryError,
    );

    rmSync(join(created.caseDirectory, "runner", "unexpected.txt"));
    rmSync(join(created.caseDirectory, "runner", "regression.test.mjs"));
    expect(() => verifyMinCase(created.caseDirectory)).toThrow(
      InvalidMinCaseDirectoryError,
    );
  });

  it("refuses a symbolic link injected into an imported case", () => {
    const root = temporaryDirectory();
    const created = createMinCase({
      name: "symlink-export",
      caseDirectory: join(root, "symlink-export.mincase"),
      outputZip: join(root, "symlink-export.mincase.zip"),
      ...inputs(),
    });
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(created.caseDirectory, "fixtures", "link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(() => verifyMinCase(created.caseDirectory)).toThrow(
      InvalidMinCaseDirectoryError,
    );
  });
});
