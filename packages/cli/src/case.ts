import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  createDeterministicMinCaseZip,
  FORMAT_VERSION,
  MinCaseManifestSchema,
  readMinCaseManifest,
  sha256,
  validateCaseName,
  validateMinCaseDirectory,
  type MinCaseManifest,
  type Minimality,
} from "@reprocore/format";
import {
  OracleDocumentSchema,
  readOracleDocument,
  type OracleDocument,
} from "@reprocore/oracles";
import { getProtocolProfile } from "@reprocore/protocol-mcp";
import {
  hasBlockingFindings,
  scanText,
  type RedactionProof,
} from "@reprocore/redaction";
import { generateStaticReport } from "@reprocore/report";
import {
  readReplayFixture,
  verifyBaseline,
  type ReplayFixture,
} from "@reprocore/replay";
import { stringify } from "yaml";
import {
  CliInputError,
  SafetyBlockedError,
  VerificationError,
  VERSION,
} from "./index.js";

interface ProofSummary {
  originalTransactionCount: number;
  finalTransactionCount: number;
  originalFieldCount: number;
  finalFieldCount: number;
  minimality: Minimality;
}

export interface CreateCaseOptions {
  name: string;
  caseDirectory: string;
  outputZip: string;
  fixture: ReplayFixture;
  oracle: OracleDocument;
  proof: unknown;
  redaction: RedactionProof;
  exportConfirmed: boolean;
}

export interface CreatedCase {
  caseDirectory: string;
  outputZip: string;
  manifest: MinCaseManifest;
}

export interface VerifyCaseResult {
  valid: boolean;
  repeat: number;
  passed: number;
  manifest: MinCaseManifest;
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new CliInputError(`Invalid proof field: ${name}`);
  }
  return value;
}

function proofSummary(proof: unknown): ProofSummary {
  if (typeof proof !== "object" || proof === null)
    throw new CliInputError("Invalid minimization proof");
  const root = proof as Record<string, unknown>;
  const transaction =
    typeof root.transaction === "object" && root.transaction !== null
      ? (root.transaction as Record<string, unknown>)
      : root;
  const structure =
    typeof root.structure === "object" && root.structure !== null
      ? (root.structure as Record<string, unknown>)
      : {};
  const transactionMinimality = transaction.minimality;
  const structureMinimality = structure.minimality ?? transactionMinimality;
  const minimality: Minimality =
    transactionMinimality === "oneMinimal" &&
    structureMinimality === "oneMinimal"
      ? "oneMinimal"
      : "budgetExhausted";
  return {
    originalTransactionCount: requireNumber(
      transaction.originalCount,
      "originalCount",
    ),
    finalTransactionCount: requireNumber(transaction.finalCount, "finalCount"),
    originalFieldCount: requireNumber(
      structure.originalFieldCount ?? 0,
      "originalFieldCount",
    ),
    finalFieldCount: requireNumber(
      structure.finalFieldCount ?? 0,
      "finalFieldCount",
    ),
    minimality,
  };
}

function writeExclusive(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "wx" });
}

const REPLAY_SERVER = `import { createHash } from "node:crypto";

const sha256 = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");

export function replayFixture(fixture) {
  const requests = fixture.exchanges.map((exchange) => exchange.request);
  const responses = fixture.exchanges.map((exchange) => ({
    ...structuredClone(exchange.response),
    id: exchange.request.id,
  }));
  const toolCalls = requests.flatMap((request) =>
    request.method === "tools/call" && typeof request.params?.name === "string"
      ? [request.params.name]
      : [],
  );
  return {
    exitCode: fixture.observation.exitCode,
    timedOut: fixture.observation.timedOut,
    durationMs: fixture.observation.durationMs,
    requestMessages: requests,
    messages: responses,
    toolCalls,
    fileHashes: Object.fromEntries(
      Object.entries(fixture.files).map(([path, content]) => [path, sha256(content)]),
    ),
    effects: fixture.observation.effects ?? [],
  };
}
`;

const REGRESSION_TEST = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { replayFixture } from "./replay-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../fixtures/replay.json", import.meta.url), "utf8"));
const oracle = JSON.parse(readFileSync(new URL("./oracle.json", import.meta.url), "utf8"));

function pointer(value, path) {
  let current = value;
  for (const token of path.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current)) return { found: false };
    current = current[key];
  }
  return { found: true, value: current };
}

function validates(value, schema) {
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    if (Array.isArray(schema.required) && schema.required.some((key) => !(key in value))) return false;
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value && !validates(value[key], child)) return false;
    }
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (schema.items && value.some((item) => !validates(item, schema.items))) return false;
  }
  if (schema.type === "string" && typeof value !== "string") return false;
  if (schema.type === "number" && typeof value !== "number") return false;
  if (schema.type === "integer" && !Number.isInteger(value)) return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  return true;
}

function evaluateRule(rule, observation) {
  if (rule.kind === "process_exit") {
    return rule.operator === "equals"
      ? observation.exitCode === rule.value
      : observation.exitCode !== rule.value;
  }
  if (rule.kind === "timeout") return observation.timedOut && observation.durationMs >= rule.timeoutMs;
  if (rule.kind === "tool_called" || rule.kind === "forbidden_tool") return observation.toolCalls.includes(rule.tool);
  if (rule.kind === "file_hash") {
    const matches = observation.fileHashes[rule.path] === rule.expected;
    return rule.operator === "equals" ? matches : !matches;
  }
  if (rule.kind === "forbidden_effect") return observation.effects.includes(rule.effect);
  if (rule.kind === "json_pointer") {
    const messages = rule.target === "last_request" ? observation.requestMessages : observation.messages;
    const found = pointer(messages.at(-1), rule.pointer);
    if (rule.operator === "exists") return found.found;
    if (rule.operator === "missing") return !found.found;
    const matches = found.found && JSON.stringify(found.value) === JSON.stringify(rule.value);
    return rule.operator === "equals" ? matches : found.found && !matches;
  }
  if (rule.kind === "json_schema_invalid") {
    const messages = rule.target === "last_request" ? observation.requestMessages : observation.messages;
    return !validates(messages.at(-1), rule.schema);
  }
  return false;
}

test("the minimized failure remains reproducible 5/5", () => {
  const outcomes = Array.from({ length: 5 }, () => {
    const observation = replayFixture(fixture);
    const values = oracle.rules.map((rule) => evaluateRule(rule, observation));
    return oracle.mode === "any" ? values.some(Boolean) : values.every(Boolean);
  });
  assert.deepEqual(outcomes, [true, true, true, true, true], root);
});
`;

const REPLAY_FIXTURE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["version", "protocolVersion", "exchanges", "files", "observation"],
  properties: {
    version: { const: 1 },
    protocolVersion: { enum: ["2025-11-25", "2026-07-28"] },
    exchanges: { type: "array", minItems: 1 },
    files: { type: "object" },
    observation: { type: "object" },
  },
  additionalProperties: false,
};

export function createMinCase(options: CreateCaseOptions): CreatedCase {
  if (!options.exportConfirmed) {
    throw new SafetyBlockedError(
      "Export requires explicit confirmation after reviewing the redaction boundary",
    );
  }
  const name = validateCaseName(options.name);
  const caseDirectory = resolve(options.caseDirectory);
  if (basename(caseDirectory) !== `${name}.mincase`) {
    throw new CliInputError(`case directory must be named ${name}.mincase`);
  }
  const fixture = JSON.stringify(options.fixture, null, 2) + "\n";
  const oracle = stringify(OracleDocumentSchema.parse(options.oracle));
  const proof = JSON.stringify(options.proof, null, 2) + "\n";
  const trace =
    options.fixture.exchanges
      .map((exchange, index) =>
        JSON.stringify({ transactionId: `exchange-${index}`, ...exchange }),
      )
      .join("\n") + "\n";
  const summary = proofSummary(options.proof);
  const baseline = verifyBaseline(options.fixture, options.oracle, 3);
  const finalVerification = verifyBaseline(options.fixture, options.oracle, 5);
  const hasCustomScript = options.oracle.rules.some(
    (rule) => rule.kind === "custom_script",
  );
  const redaction: RedactionProof = structuredClone(options.redaction);
  redaction.replayVerified = finalVerification.status === "STABLE";
  const exportScan = [
    fixture,
    oracle,
    proof,
    trace,
    REPLAY_SERVER,
    REGRESSION_TEST,
  ].flatMap((content, index) => scanText(content, `export-${index}`));
  redaction.findings.push(...exportScan);
  redaction.verified = redaction.verified && !hasBlockingFindings(exportScan);
  if (!redaction.verified) {
    throw new SafetyBlockedError(
      "Export blocked because the second-pass scan found sensitive content",
    );
  }
  const executable =
    !hasCustomScript &&
    baseline.status === "STABLE" &&
    finalVerification.status === "STABLE" &&
    redaction.verified &&
    options.exportConfirmed;
  const manifest: MinCaseManifest = MinCaseManifestSchema.parse({
    formatVersion: FORMAT_VERSION,
    name,
    caseType: executable ? "executable" : "explanatory",
    minimality: summary.minimality,
    protocolProfile: getProtocolProfile(options.fixture.protocolVersion),
    originalTransactionCount: summary.originalTransactionCount,
    finalTransactionCount: summary.finalTransactionCount,
    originalFieldCount: summary.originalFieldCount,
    finalFieldCount: summary.finalFieldCount,
    oracleHash: sha256(oracle),
    fixtureHash: sha256(fixture),
    proofHash: sha256(proof),
    traceHash: sha256(trace),
    reducerSet: ["transaction-ddmin-v1", "schema-json-v1", "unused-tools-v1"],
    baseline: {
      repeat: 3,
      passed: baseline.evaluations.filter(
        (entry) => entry.result === "INTERESTING",
      ).length,
    },
    finalVerification: {
      repeat: 5,
      passed: finalVerification.evaluations.filter(
        (entry) => entry.result === "INTERESTING",
      ).length,
    },
    redactionVerified: redaction.verified && redaction.replayVerified,
    sensitivity: redaction.substitutions.length === 0 ? "metadata" : "content",
    exportConfirmed: options.exportConfirmed,
  });

  const provenance =
    JSON.stringify(
      {
        version: 1,
        generatedBy: `reprocore@${VERSION}`,
        node: ">=22.13.0",
        fixtureHash: manifest.fixtureHash,
        oracleHash: manifest.oracleHash,
        proofHash: manifest.proofHash,
        traceHash: manifest.traceHash,
      },
      null,
      2,
    ) + "\n";
  const report = generateStaticReport({
    manifest,
    proof: options.proof,
    redaction,
  });

  mkdirSync(dirname(caseDirectory), { recursive: true });
  mkdirSync(caseDirectory);

  writeExclusive(join(caseDirectory, "manifest.yaml"), stringify(manifest));
  writeExclusive(join(caseDirectory, "trace.jsonl"), trace);
  writeExclusive(join(caseDirectory, "oracle.yaml"), oracle);
  writeExclusive(join(caseDirectory, "provenance.json"), provenance);
  writeExclusive(join(caseDirectory, "redaction.yaml"), stringify(redaction));
  writeExclusive(join(caseDirectory, "report.html"), report);
  writeExclusive(
    join(caseDirectory, "package.json"),
    JSON.stringify(
      {
        name: "reprocore-mincase",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: { test: "node --test runner/regression.test.mjs" },
      },
      null,
      2,
    ) + "\n",
  );
  writeExclusive(join(caseDirectory, "fixtures", "replay.json"), fixture);
  writeExclusive(join(caseDirectory, "artifacts", "proof.json"), proof);
  writeExclusive(
    join(caseDirectory, "schemas", "replay-fixture.schema.json"),
    JSON.stringify(REPLAY_FIXTURE_SCHEMA, null, 2) + "\n",
  );
  writeExclusive(
    join(caseDirectory, "runner", "oracle.json"),
    JSON.stringify(options.oracle, null, 2) + "\n",
  );
  writeExclusive(
    join(caseDirectory, "runner", "replay-server.mjs"),
    REPLAY_SERVER,
  );
  writeExclusive(
    join(caseDirectory, "runner", "regression.test.mjs"),
    REGRESSION_TEST,
  );
  createDeterministicMinCaseZip(caseDirectory, resolve(options.outputZip));
  return { caseDirectory, outputZip: resolve(options.outputZip), manifest };
}

export function verifyMinCase(
  caseDirectory: string,
  repeat = 5,
): VerifyCaseResult {
  const root = resolve(caseDirectory);
  validateMinCaseDirectory(root);
  const manifest = readMinCaseManifest(root);
  const fixturePath = join(root, "fixtures", "replay.json");
  const oraclePath = join(root, "oracle.yaml");
  const proofPath = join(root, "artifacts", "proof.json");
  const tracePath = join(root, "trace.jsonl");
  if (sha256(readFileSync(fixturePath)) !== manifest.fixtureHash) {
    throw new VerificationError("Fixture hash does not match manifest");
  }
  if (sha256(readFileSync(oraclePath)) !== manifest.oracleHash) {
    throw new VerificationError("Oracle hash does not match manifest");
  }
  if (sha256(readFileSync(proofPath)) !== manifest.proofHash) {
    throw new VerificationError("Proof hash does not match manifest");
  }
  if (sha256(readFileSync(tracePath)) !== manifest.traceHash) {
    throw new VerificationError("Trace hash does not match manifest");
  }
  const fixture = readReplayFixture(fixturePath);
  const oracle = readOracleDocument(oraclePath);
  const verification = verifyBaseline(fixture, oracle, repeat);
  const passed = verification.evaluations.filter(
    (entry) => entry.result === "INTERESTING",
  ).length;
  return { valid: verification.status === "STABLE", repeat, passed, manifest };
}
