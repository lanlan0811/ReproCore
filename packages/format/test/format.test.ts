import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  assertSupportedFormatVersion,
  canonicalJson,
  createDeterministicMinCaseZip,
  InvalidMinCaseDirectoryError,
  MinCaseEventSchema,
  parseJsonObject,
  readMinCaseManifest,
  scanSecretCandidates,
  sha256,
  summarizeValue,
  UnsupportedFormatVersionError,
  validateCaseName,
  validateMinCaseDirectory,
} from "../src/index.js";

describe("format contracts", () => {
  it("serializes object keys deterministically", () => {
    expect(canonicalJson({ zebra: 1, alpha: [true, null] })).toBe(
      '{"alpha":[true,null],"zebra":1}',
    );
    expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonObject("[]")).toBeUndefined();
    expect(parseJsonObject("not-json")).toBeUndefined();
  });

  it("rejects unknown format major versions", () => {
    expect(() => assertSupportedFormatVersion("2.0.0")).toThrow(
      UnsupportedFormatVersionError,
    );
    expect(() => assertSupportedFormatVersion("1.9.0")).not.toThrow();
  });

  it("validates normalized events and content hashes", () => {
    expect(
      MinCaseEventSchema.parse({
        eventId: "event-1",
        channel: "mcp",
        kind: "request:tools/list",
        parentIds: [],
        payloadRef: sha256("{}"),
        sensitivity: "metadata",
        replayMode: "fixture",
      }),
    ).toBeDefined();
  });

  it("summarizes values without retaining scalar content", () => {
    const summary = summarizeValue({ password: "not-a-real-password" });
    expect(JSON.stringify(summary)).not.toContain("not-a-real-password");
  });

  it("detects common credential shapes", () => {
    expect(
      scanSecretCandidates("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"),
    ).toEqual([expect.objectContaining({ kind: "authorization" })]);
    expect(scanSecretCandidates('{"api_key":"abcdefghijklmnop"}')).toEqual([
      expect.objectContaining({ kind: "api_key" }),
    ]);
    expect(scanSecretCandidates("Cookie: session=abcdefghijklmnop")).toEqual([
      expect.objectContaining({ kind: "cookie" }),
    ]);
    expect(scanSecretCandidates('oauth_code="abcdefghijklmnop"')).toEqual([
      expect.objectContaining({ kind: "oauth_code" }),
    ]);
    expect(scanSecretCandidates("ordinary text")).toHaveLength(0);
  });

  it("validates and creates deterministic portable case archives", () => {
    const root = mkdtempSync(join(tmpdir(), "reprocore-format-"));
    try {
      const caseDirectory = join(root, "portable.mincase");
      mkdirSync(caseDirectory, { recursive: true });
      const hash = `sha256:${"a".repeat(64)}`;
      const manifest = {
        formatVersion: "1.0.0",
        name: "portable",
        caseType: "executable",
        minimality: "oneMinimal",
        protocolProfile: {
          id: "modern-2026-07-28",
          protocolVersion: "2026-07-28",
          lifecycle: "stateless",
          initializeRequired: false,
          discoveryMethod: "server/discover",
          loggingTransport: "stderr",
        },
        originalTransactionCount: 10,
        finalTransactionCount: 1,
        originalFieldCount: 10,
        finalFieldCount: 1,
        oracleHash: hash,
        fixtureHash: hash,
        proofHash: hash,
        traceHash: hash,
        artifactHashes: {
          "package.json": hash,
          "provenance.json": hash,
          "redaction.yaml": hash,
          "report.html": hash,
          "runner/oracle.json": hash,
          "runner/regression.test.mjs": hash,
          "runner/replay-server.mjs": hash,
          "schemas/replay-fixture.schema.json": hash,
        },
        reducerSet: ["transaction-ddmin-v1"],
        baseline: { repeat: 3, passed: 3 },
        finalVerification: { repeat: 5, passed: 5 },
        redactionVerified: true,
        sensitivity: "metadata",
        exportConfirmed: true,
      };
      const files: Record<string, string> = {
        "manifest.yaml": stringify(manifest),
        "oracle.yaml": "version: 1\n",
        "package.json": "{}\n",
        "provenance.json": "{}\n",
        "redaction.yaml": "version: 1\n",
        "report.html": "<!doctype html>\n",
        "trace.jsonl": "{}\n",
        "artifacts/proof.json": "{}\n",
        "fixtures/replay.json": "{}\n",
        "runner/oracle.json": "{}\n",
        "runner/regression.test.mjs": "// regression\n",
        "runner/replay-server.mjs": "// replay\n",
        "schemas/replay-fixture.schema.json": "{}\n",
      };
      for (const [path, content] of Object.entries(files)) {
        const target = join(caseDirectory, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }

      expect(validateCaseName("portable-case_1")).toBe("portable-case_1");
      expect(() => validateCaseName("Invalid Name")).toThrow(
        InvalidMinCaseDirectoryError,
      );
      expect(validateMinCaseDirectory(caseDirectory).size).toBe(13);
      expect(readMinCaseManifest(caseDirectory).name).toBe("portable");
      const zipPath = join(root, "nested", "portable.mincase.zip");
      createDeterministicMinCaseZip(caseDirectory, zipPath);
      expect(readFileSync(zipPath).length).toBeGreaterThan(0);

      writeFileSync(join(caseDirectory, "raw-frames.jsonl"), "{}\n");
      expect(() => validateMinCaseDirectory(caseDirectory)).toThrow(
        "unexpected top-level entry",
      );
      rmSync(join(caseDirectory, "raw-frames.jsonl"));
      writeFileSync(join(caseDirectory, "runner", "unexpected.txt"), "x");
      expect(() => validateMinCaseDirectory(caseDirectory)).toThrow(
        "unexpected case file",
      );
      rmSync(join(caseDirectory, "runner", "unexpected.txt"));
      rmSync(join(caseDirectory, "runner", "regression.test.mjs"));
      expect(() => validateMinCaseDirectory(caseDirectory)).toThrow(
        "required case file is missing",
      );
      expect(() => validateMinCaseDirectory(join(root, "not-a-case"))).toThrow(
        "working case directory must end with .mincase",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
