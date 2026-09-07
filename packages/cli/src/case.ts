import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
  RedactionProofSchema,
  scanText,
  type RedactionProof,
} from "@reprocore/redaction";
import { generateStaticReport } from "@reprocore/report";
import {
  readReplayFixture,
  verifyBaseline,
  type ReplayFixture,
} from "@reprocore/replay";
import { parse, stringify } from "yaml";
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
import { isDeepStrictEqual } from "node:util";
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

function schemaTypeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validates(value, schema) {
  if (typeof schema === "boolean") return schema;
  if (schema === null || typeof schema !== "object") return false;
  if (Array.isArray(schema.allOf) && !schema.allOf.every((child) => validates(value, child))) return false;
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((child) => validates(value, child))) return false;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((child) => validates(value, child)).length !== 1) return false;
  if (schema.not !== undefined && validates(value, schema.not)) return false;
  if (schema.if !== undefined) {
    const branch = validates(value, schema.if) ? schema.then : schema.else;
    if (branch !== undefined && !validates(value, branch)) return false;
  }
  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => isDeepStrictEqual(item, value))) return false;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => schemaTypeMatches(value, type))) return false;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return false;
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) return false;
    if (typeof schema.multipleOf === "number" && !Number.isInteger(value / schema.multipleOf)) return false;
  }
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && length > schema.maxLength) return false;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && value.some((item, index) => value.slice(0, index).some((prior) => isDeepStrictEqual(prior, item)))) return false;
    const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    if (prefix.some((child, index) => index < value.length && !validates(value[index], child))) return false;
    if (schema.items !== undefined) {
      for (let index = prefix.length; index < value.length; index += 1) {
        if (!validates(value[index], schema.items)) return false;
      }
    }
    if (schema.contains !== undefined) {
      const count = value.filter((item) => validates(item, schema.contains)).length;
      const minimum = schema.minContains ?? 1;
      if (count < minimum || (typeof schema.maxContains === "number" && count > schema.maxContains)) return false;
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) return false;
    if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) return false;
    if (Array.isArray(schema.required) && schema.required.some((key) => !Object.hasOwn(value, key))) return false;
    const properties = schema.properties ?? {};
    const patterns = Object.entries(schema.patternProperties ?? {}).map(([pattern, child]) => [new RegExp(pattern, "u"), child]);
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key) && !validates(value[key], child)) return false;
    }
    for (const [key, childValue] of Object.entries(value)) {
      const matchingPatterns = patterns.filter(([pattern]) => pattern.test(key));
      if (matchingPatterns.some(([, child]) => !validates(childValue, child))) return false;
      if (!Object.hasOwn(properties, key) && matchingPatterns.length === 0 && schema.additionalProperties !== undefined && !validates(childValue, schema.additionalProperties)) return false;
    }
    if (schema.propertyNames !== undefined && keys.some((key) => !validates(key, schema.propertyNames))) return false;
    for (const [key, dependencies] of Object.entries(schema.dependentRequired ?? {})) {
      if (Object.hasOwn(value, key) && dependencies.some((dependency) => !Object.hasOwn(value, dependency))) return false;
    }
    for (const [key, child] of Object.entries(schema.dependentSchemas ?? {})) {
      if (Object.hasOwn(value, key) && !validates(value, child)) return false;
    }
  }
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
    const matches = found.found && isDeepStrictEqual(found.value, rule.value);
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

const STANDALONE_SCHEMA_KEYWORDS = new Set([
  "$comment",
  "$defs",
  "$id",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "contains",
  "default",
  "dependentRequired",
  "dependentSchemas",
  "deprecated",
  "description",
  "else",
  "enum",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "if",
  "items",
  "maximum",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "minimum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "multipleOf",
  "not",
  "oneOf",
  "pattern",
  "patternProperties",
  "prefixItems",
  "properties",
  "propertyNames",
  "readOnly",
  "required",
  "then",
  "title",
  "type",
  "uniqueItems",
  "writeOnly",
]);

function supportsStandaloneSchema(schema: unknown): boolean {
  if (typeof schema === "boolean") return true;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return false;
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (!STANDALONE_SCHEMA_KEYWORDS.has(keyword)) return false;
    if (
      [
        "additionalProperties",
        "contains",
        "else",
        "if",
        "items",
        "not",
        "propertyNames",
        "then",
      ].includes(keyword) &&
      !supportsStandaloneSchema(value)
    ) {
      return false;
    }
    if (
      ["allOf", "anyOf", "oneOf", "prefixItems"].includes(keyword) &&
      (!Array.isArray(value) ||
        value.some((child) => !supportsStandaloneSchema(child)))
    ) {
      return false;
    }
    if (
      ["$defs", "dependentSchemas", "patternProperties", "properties"].includes(
        keyword,
      ) &&
      (typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.values(value).some((child) => !supportsStandaloneSchema(child)))
    ) {
      return false;
    }
  }
  return true;
}

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
  const parsedOracle = OracleDocumentSchema.parse(options.oracle);
  const fixture = JSON.stringify(options.fixture, null, 2) + "\n";
  const oracle = stringify(parsedOracle);
  const proof = JSON.stringify(options.proof, null, 2) + "\n";
  const trace =
    options.fixture.exchanges
      .map((exchange, index) =>
        JSON.stringify({ transactionId: `exchange-${index}`, ...exchange }),
      )
      .join("\n") + "\n";
  const summary = proofSummary(options.proof);
  const baseline = verifyBaseline(options.fixture, parsedOracle, 3);
  const finalVerification = verifyBaseline(options.fixture, parsedOracle, 5);
  const hasCustomScript = parsedOracle.rules.some(
    (rule) => rule.kind === "custom_script",
  );
  const standaloneSchemaCompatible = parsedOracle.rules.every(
    (rule) =>
      rule.kind !== "json_schema_invalid" ||
      supportsStandaloneSchema(rule.schema),
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
    standaloneSchemaCompatible &&
    baseline.status === "STABLE" &&
    finalVerification.status === "STABLE" &&
    redaction.verified &&
    options.exportConfirmed;
  const fixtureHash = sha256(fixture);
  const oracleHash = sha256(oracle);
  const proofHash = sha256(proof);
  const traceHash = sha256(trace);
  const provenance =
    JSON.stringify(
      {
        version: 1,
        generatedBy: `reprocore@${VERSION}`,
        node: ">=22.13.0",
        fixtureHash,
        oracleHash,
        proofHash,
        traceHash,
        standaloneRegressionCompatible: standaloneSchemaCompatible,
      },
      null,
      2,
    ) + "\n";
  const redactionDocument = stringify(redaction);
  const packageDocument =
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
    ) + "\n";
  const schemaDocument = JSON.stringify(REPLAY_FIXTURE_SCHEMA, null, 2) + "\n";
  const runnerOracle = JSON.stringify(parsedOracle, null, 2) + "\n";
  const manifestFields = {
    formatVersion: FORMAT_VERSION,
    name,
    caseType: executable ? "executable" : "explanatory",
    minimality: summary.minimality,
    protocolProfile: getProtocolProfile(options.fixture.protocolVersion),
    originalTransactionCount: summary.originalTransactionCount,
    finalTransactionCount: summary.finalTransactionCount,
    originalFieldCount: summary.originalFieldCount,
    finalFieldCount: summary.finalFieldCount,
    oracleHash,
    fixtureHash,
    proofHash,
    traceHash,
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
  } as const;
  const report = generateStaticReport({
    manifest: manifestFields,
    proof: options.proof,
    redaction,
  });
  const manifest: MinCaseManifest = MinCaseManifestSchema.parse({
    ...manifestFields,
    artifactHashes: {
      "package.json": sha256(packageDocument),
      "provenance.json": sha256(provenance),
      "redaction.yaml": sha256(redactionDocument),
      "report.html": sha256(report),
      "runner/oracle.json": sha256(runnerOracle),
      "runner/regression.test.mjs": sha256(REGRESSION_TEST),
      "runner/replay-server.mjs": sha256(REPLAY_SERVER),
      "schemas/replay-fixture.schema.json": sha256(schemaDocument),
    },
  });
  const finalExportScan = [
    packageDocument,
    provenance,
    redactionDocument,
    report,
    runnerOracle,
    schemaDocument,
  ].flatMap((content, index) => scanText(content, `artifact-${index}`));
  if (hasBlockingFindings(finalExportScan)) {
    throw new SafetyBlockedError(
      "Export blocked because a generated artifact contains sensitive content",
    );
  }

  mkdirSync(dirname(caseDirectory), { recursive: true });
  mkdirSync(caseDirectory);

  writeExclusive(join(caseDirectory, "manifest.yaml"), stringify(manifest));
  writeExclusive(join(caseDirectory, "trace.jsonl"), trace);
  writeExclusive(join(caseDirectory, "oracle.yaml"), oracle);
  writeExclusive(join(caseDirectory, "provenance.json"), provenance);
  writeExclusive(join(caseDirectory, "redaction.yaml"), redactionDocument);
  writeExclusive(join(caseDirectory, "report.html"), report);
  writeExclusive(join(caseDirectory, "package.json"), packageDocument);
  writeExclusive(join(caseDirectory, "fixtures", "replay.json"), fixture);
  writeExclusive(join(caseDirectory, "artifacts", "proof.json"), proof);
  writeExclusive(
    join(caseDirectory, "schemas", "replay-fixture.schema.json"),
    schemaDocument,
  );
  writeExclusive(join(caseDirectory, "runner", "oracle.json"), runnerOracle);
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
  const files = validateMinCaseDirectory(root);
  const manifest = readMinCaseManifest(root);
  const fixturePath = join(root, "fixtures", "replay.json");
  const oraclePath = join(root, "oracle.yaml");
  const proofPath = join(root, "artifacts", "proof.json");
  const tracePath = join(root, "trace.jsonl");
  for (const [path, expected] of Object.entries(manifest.artifactHashes)) {
    const content = files.get(path);
    if (content === undefined || sha256(content) !== expected) {
      throw new VerificationError(
        `Artifact hash does not match manifest: ${path}`,
      );
    }
  }
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
  const runnerOracle = OracleDocumentSchema.parse(
    JSON.parse(readFileSync(join(root, "runner", "oracle.json"), "utf8")),
  );
  if (!isDeepStrictEqual(runnerOracle, oracle)) {
    throw new VerificationError("Runner Oracle does not match oracle.yaml");
  }
  const redaction = RedactionProofSchema.parse(
    parse(readFileSync(join(root, "redaction.yaml"), "utf8")),
  );
  if (
    manifest.redactionVerified !==
    (redaction.verified && redaction.replayVerified)
  ) {
    throw new VerificationError(
      "Redaction proof does not match the manifest verification state",
    );
  }
  const verification = verifyBaseline(fixture, oracle, repeat);
  const passed = verification.evaluations.filter(
    (entry) => entry.result === "INTERESTING",
  ).length;
  return { valid: verification.status === "STABLE", repeat, passed, manifest };
}
