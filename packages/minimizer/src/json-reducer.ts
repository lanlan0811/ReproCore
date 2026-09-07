import {
  canonicalJson,
  compileJsonSchema,
  sha256,
  type CandidateResult,
  type JsonValue,
  type Minimality,
} from "@reprocore/format";
import type { CandidateCacheLike } from "./cache.js";

type JsonSchema = Record<string, unknown>;
type JsonPath = Array<string | number>;

export interface JsonMeasure {
  fieldCount: number;
  serializedBytes: number;
}

export interface JsonProofLedgerEntry {
  candidateHash: string;
  operation: string;
  path: string;
  result: CandidateResult;
  valid: boolean;
  durationMs: number;
  cacheHit: boolean;
}

export interface JsonReduceOptions {
  schema: JsonSchema;
  test: (candidate: JsonValue) => Promise<CandidateResult>;
  maxTests?: number;
  maxDurationMs?: number;
  cache?: CandidateCacheLike;
  cacheNamespace?: string;
}

export interface JsonReduceResult {
  value: JsonValue;
  originalMeasure: JsonMeasure;
  finalMeasure: JsonMeasure;
  fieldReductionRate: number;
  minimality: Minimality;
  ledger: JsonProofLedgerEntry[];
  testCount: number;
}

interface ReductionCandidate {
  value: JsonValue;
  operation: string;
  path: JsonPath;
}

function schemaObject(value: unknown): JsonSchema | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : undefined;
}

function nestedSchemas(schema: JsonSchema): JsonSchema[] {
  return ["allOf", "anyOf", "oneOf"].flatMap((keyword) => {
    const entries = schema[keyword];
    return Array.isArray(entries)
      ? entries.flatMap((entry) => {
          const parsed = schemaObject(entry);
          return parsed === undefined ? [] : [parsed];
        })
      : [];
  });
}

function propertySchema(schema: JsonSchema, key: string): JsonSchema {
  const properties = schemaObject(schema.properties);
  const direct =
    properties === undefined ? undefined : schemaObject(properties[key]);
  if (direct !== undefined) return direct;
  for (const nested of nestedSchemas(schema)) {
    const found = propertySchema(nested, key);
    if (Object.keys(found).length > 0) return found;
  }
  return {};
}

function itemSchema(schema: JsonSchema, index: number): JsonSchema {
  const prefixItems = schema.prefixItems;
  if (Array.isArray(prefixItems)) return schemaObject(prefixItems[index]) ?? {};
  return schemaObject(schema.items) ?? {};
}

function requiredKeys(schema: JsonSchema): Set<string> {
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  );
  for (const nested of nestedSchemas(schema)) {
    for (const key of requiredKeys(nested)) required.add(key);
  }
  return required;
}

function replaceAt(
  root: JsonValue,
  path: JsonPath,
  replacement: JsonValue,
): JsonValue {
  if (path.length === 0) return replacement;
  const clone = structuredClone(root);
  let parent: JsonValue = clone;
  for (const segment of path.slice(0, -1)) {
    parent = Array.isArray(parent)
      ? parent[segment as number]!
      : (parent as Record<string, JsonValue>)[segment as string]!;
  }
  const final = path.at(-1)!;
  if (Array.isArray(parent)) parent[final as number] = replacement;
  else (parent as Record<string, JsonValue>)[final as string] = replacement;
  return clone;
}

function deleteAt(root: JsonValue, path: JsonPath): JsonValue {
  const clone = structuredClone(root);
  let parent: JsonValue = clone;
  for (const segment of path.slice(0, -1)) {
    parent = Array.isArray(parent)
      ? parent[segment as number]!
      : (parent as Record<string, JsonValue>)[segment as string]!;
  }
  const final = path.at(-1)!;
  if (Array.isArray(parent)) parent.splice(final as number, 1);
  else delete (parent as Record<string, JsonValue>)[final as string];
  return clone;
}

function scalarCandidates(value: JsonValue, schema: JsonSchema): JsonValue[] {
  const candidates: JsonValue[] = [];
  const enumValues = schema.enum;
  if (Array.isArray(enumValues)) {
    for (const entry of enumValues) {
      if (
        entry === null ||
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean" ||
        Array.isArray(entry) ||
        typeof entry === "object"
      ) {
        candidates.push(entry as JsonValue);
      }
    }
  }
  for (const nested of nestedSchemas(schema))
    candidates.push(...scalarCandidates(value, nested));

  if (typeof value === "string") {
    candidates.push(
      "",
      value.slice(0, Math.floor(value.length / 2)),
      value.slice(0, 1),
    );
    if (typeof schema.minLength === "number") {
      candidates.push(value.slice(0, schema.minLength));
    }
  } else if (typeof value === "number") {
    candidates.push(0, Math.trunc(value / 2));
    if (typeof schema.minimum === "number") candidates.push(schema.minimum);
    if (typeof schema.maximum === "number") candidates.push(schema.maximum);
  } else if (value === true) {
    candidates.push(false);
  }
  return candidates;
}

export function measureJson(value: JsonValue): JsonMeasure {
  let fieldCount = 0;
  const visit = (entry: JsonValue): void => {
    if (Array.isArray(entry)) {
      fieldCount += entry.length;
      for (const item of entry) visit(item);
    } else if (typeof entry === "object" && entry !== null) {
      const values = Object.values(entry);
      fieldCount += values.length;
      for (const item of values) visit(item);
    }
  };
  visit(value);
  return {
    fieldCount,
    serializedBytes: Buffer.byteLength(canonicalJson(value)),
  };
}

function smaller(left: JsonMeasure, right: JsonMeasure): boolean {
  return (
    left.fieldCount < right.fieldCount ||
    (left.fieldCount === right.fieldCount &&
      left.serializedBytes < right.serializedBytes)
  );
}

function pointer(path: JsonPath): string {
  if (path.length === 0) return "";
  return `/${path
    .map((segment) =>
      String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
    )
    .join("/")}`;
}

function enumerateReductions(
  root: JsonValue,
  value: JsonValue,
  schema: JsonSchema,
  path: JsonPath,
  target: ReductionCandidate[],
): void {
  if (Array.isArray(value)) {
    const minimumItems =
      typeof schema.minItems === "number" ? schema.minItems : 0;
    if (value.length > minimumItems) {
      for (let index = 0; index < value.length; index += 1) {
        target.push({
          value: deleteAt(root, [...path, index]),
          operation: "delete-array-item",
          path: [...path, index],
        });
      }
    }
    value.forEach((entry, index) =>
      enumerateReductions(
        root,
        entry,
        itemSchema(schema, index),
        [...path, index],
        target,
      ),
    );
    return;
  }

  if (typeof value === "object" && value !== null) {
    const required = requiredKeys(schema);
    for (const [key, entry] of Object.entries(value)) {
      if (!required.has(key)) {
        target.push({
          value: deleteAt(root, [...path, key]),
          operation: "delete-object-key",
          path: [...path, key],
        });
      }
      enumerateReductions(
        root,
        entry,
        propertySchema(schema, key),
        [...path, key],
        target,
      );
    }
    return;
  }

  for (const replacement of scalarCandidates(value, schema)) {
    target.push({
      value: replaceAt(root, path, replacement),
      operation:
        Array.isArray(schema.enum) ||
        nestedSchemas(schema).some((item) => Array.isArray(item.enum))
          ? "reduce-enum"
          : typeof value === "string"
            ? "reduce-string"
            : typeof value === "number"
              ? "reduce-number"
              : "reduce-scalar",
      path,
    });
  }
}

export async function minimizeJson(
  original: JsonValue,
  options: JsonReduceOptions,
): Promise<JsonReduceResult> {
  const validate = compileJsonSchema(options.schema);
  const originalMeasure = measureJson(original);
  const ledger: JsonProofLedgerEntry[] = [];
  const startedAt = Date.now();
  const maxTests = options.maxTests ?? 10_000;
  const maxDurationMs = options.maxDurationMs ?? 10 * 60 * 1_000;
  let current = structuredClone(original);
  let testCount = 0;
  let budgetExhausted = false;

  const evaluate = async (
    candidate: ReductionCandidate,
  ): Promise<CandidateResult> => {
    const candidateHash = sha256(
      `${options.cacheNamespace ?? "json-v1"}\n${canonicalJson(candidate.value)}`,
    );
    const cached = options.cache?.get(candidateHash);
    if (cached !== undefined) {
      ledger.push({
        candidateHash,
        operation: candidate.operation,
        path: pointer(candidate.path),
        result: cached.result,
        valid: true,
        durationMs: cached.durationMs,
        cacheHit: true,
      });
      return cached.result;
    }
    if (testCount >= maxTests || Date.now() - startedAt >= maxDurationMs) {
      budgetExhausted = true;
      return "UNRESOLVED";
    }
    const began = Date.now();
    const valid = validate(candidate.value) as boolean;
    const result = valid ? await options.test(candidate.value) : "UNRESOLVED";
    const durationMs = Date.now() - began;
    testCount += 1;
    ledger.push({
      candidateHash,
      operation: candidate.operation,
      path: pointer(candidate.path),
      result,
      valid,
      durationMs,
      cacheHit: false,
    });
    if (valid) options.cache?.set(candidateHash, { result, durationMs });
    return result;
  };

  if (
    (await evaluate({ value: current, operation: "baseline", path: [] })) !==
    "INTERESTING"
  ) {
    return {
      value: current,
      originalMeasure,
      finalMeasure: originalMeasure,
      fieldReductionRate: 0,
      minimality: "budgetExhausted",
      ledger,
      testCount,
    };
  }

  let changed = true;
  while (changed && !budgetExhausted) {
    changed = false;
    const currentMeasure = measureJson(current);
    const candidates: ReductionCandidate[] = [];
    enumerateReductions(current, current, options.schema, [], candidates);
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const serialized = canonicalJson(candidate.value);
      if (
        seen.has(serialized) ||
        !smaller(measureJson(candidate.value), currentMeasure)
      )
        continue;
      seen.add(serialized);
      if ((await evaluate(candidate)) === "INTERESTING") {
        current = candidate.value;
        changed = true;
        break;
      }
    }
  }

  const finalMeasure = measureJson(current);
  return {
    value: current,
    originalMeasure,
    finalMeasure,
    fieldReductionRate:
      originalMeasure.fieldCount === 0
        ? 0
        : 1 - finalMeasure.fieldCount / originalMeasure.fieldCount,
    minimality: budgetExhausted ? "budgetExhausted" : "oneMinimal",
    ledger,
    testCount,
  };
}

export function removeUnusedToolDefinitions(
  message: JsonValue,
  usedTools: ReadonlySet<string>,
): JsonValue {
  const clone = structuredClone(message);
  if (typeof clone !== "object" || clone === null || Array.isArray(clone))
    return clone;
  const result = clone.result;
  if (typeof result !== "object" || result === null || Array.isArray(result))
    return clone;
  if (!Array.isArray(result.tools)) return clone;
  result.tools = result.tools.filter((tool) => {
    if (typeof tool !== "object" || tool === null || Array.isArray(tool))
      return false;
    return typeof tool.name === "string" && usedTools.has(tool.name);
  });
  return clone;
}
