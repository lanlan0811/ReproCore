import {
  canonicalJson,
  sha256,
  type CandidateResult,
  type JsonValue,
  type Minimality,
} from "@reprocore/format";
import { isDeepStrictEqual } from "node:util";
import {
  measureJson,
  minimizeJson,
  removeUnusedToolDefinitions,
  type CandidateCacheLike,
  type JsonProofLedgerEntry,
} from "@reprocore/minimizer";
import { evaluateOracle, type OracleDocument } from "@reprocore/oracles";
import {
  ReplayFixtureSchema,
  runFixtureReplay,
  type ReplayFixture,
} from "@reprocore/replay";

export interface FixtureJsonReductionOptions {
  cache?: CandidateCacheLike;
  evaluate?: (fixture: ReplayFixture) => Promise<CandidateResult>;
  evaluationIdentity?: string;
  maxTests: number;
  maxDurationMs: number;
}

export interface FixtureJsonReductionResult {
  fixture: ReplayFixture;
  ledgers: JsonProofLedgerEntry[][];
  minimality: Minimality;
  originalFieldCount: number;
  finalFieldCount: number;
  fieldReductionRate: number;
  testCount: number;
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function calledTools(fixture: ReplayFixture): Set<string> {
  return new Set(
    fixture.exchanges.flatMap(({ request }) => {
      if (request.method !== "tools/call") return [];
      const params = request.params;
      if (typeof params !== "object" || params === null) return [];
      const name = (params as Record<string, unknown>).name;
      return typeof name === "string" ? [name] : [];
    }),
  );
}

function toolSchemas(fixture: ReplayFixture): Map<string, JsonValue> {
  const schemas = new Map<string, JsonValue>();
  for (const { response } of fixture.exchanges) {
    const result = response.result;
    if (typeof result !== "object" || result === null) continue;
    const tools = (result as Record<string, unknown>).tools;
    if (!Array.isArray(tools)) continue;
    for (const tool of tools) {
      if (typeof tool !== "object" || tool === null) continue;
      const record = tool as Record<string, unknown>;
      if (
        typeof record.name === "string" &&
        typeof record.inputSchema === "object"
      ) {
        schemas.set(record.name, asJsonValue(record.inputSchema));
      }
    }
  }
  return schemas;
}

function exchangeSchema(
  exchange: ReplayFixture["exchanges"][number],
  schemas: ReadonlyMap<string, JsonValue>,
  freezeResponseResult: boolean,
): Record<string, unknown> {
  const request = exchange.request;
  const requestProperties: Record<string, unknown> = {
    jsonrpc: { const: "2.0" },
    method: { const: request.method },
  };
  const requestRequired = ["jsonrpc", "method"];
  if (request.id !== undefined) {
    requestProperties.id = { const: request.id };
    requestRequired.push("id");
  }
  if (request.method === "tools/call") {
    const params = request.params as Record<string, unknown>;
    const name = typeof params?.name === "string" ? params.name : "";
    requestProperties.params = {
      type: "object",
      required: ["name", "arguments"],
      properties: {
        name: { const: name },
        arguments: schemas.get(name) ?? {},
      },
      additionalProperties: true,
    };
    requestRequired.push("params");
  } else if (request.params !== undefined) {
    requestProperties.params = {};
  }

  const response = exchange.response;
  const responseProperties: Record<string, unknown> = {
    jsonrpc: { const: "2.0" },
  };
  const responseRequired = ["jsonrpc"];
  if (response.id !== undefined) {
    responseProperties.id = { const: response.id };
    responseRequired.push("id");
  }
  if ("result" in response) {
    responseProperties.result = freezeResponseResult
      ? { const: response.result }
      : {};
    responseRequired.push("result");
  } else if ("error" in response) {
    responseProperties.error = {};
    responseRequired.push("error");
  }

  return {
    type: "object",
    required: ["request", "response"],
    properties: {
      request: {
        type: "object",
        required: requestRequired,
        properties: requestProperties,
        additionalProperties: false,
      },
      response: {
        type: "object",
        required: responseRequired,
        properties: responseProperties,
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}

export async function minimizeFixtureJson(
  input: ReplayFixture,
  oracle: OracleDocument,
  options: FixtureJsonReductionOptions,
): Promise<FixtureJsonReductionResult> {
  const startedAt = Date.now();
  const tools = calledTools(input);
  const schemas = toolSchemas(input);
  let fixture = structuredClone(input);
  const originalFieldCount = fixture.exchanges.reduce(
    (total, exchange) => total + measureJson(asJsonValue(exchange)).fieldCount,
    0,
  );
  const ledgers: JsonProofLedgerEntry[][] = [];
  let testCount = 0;
  let minimality: Minimality = "oneMinimal";
  const evaluate =
    options.evaluate ??
    (async (fixture: ReplayFixture) =>
      evaluateOracle(oracle, runFixtureReplay(fixture).observation).result);

  for (let index = 0; index < fixture.exchanges.length; index += 1) {
    if (
      testCount >= options.maxTests ||
      Date.now() - startedAt >= options.maxDurationMs
    ) {
      minimality = "budgetExhausted";
      break;
    }
    const exchange = fixture.exchanges[index]!;
    const isDiscovery =
      exchange.request.method === "tools/list" ||
      exchange.request.method === "server/discover";
    const originalResponse = asJsonValue(exchange.response);
    const prunedResponse = isDiscovery
      ? removeUnusedToolDefinitions(originalResponse, tools)
      : originalResponse;
    const prunedFixture = ReplayFixtureSchema.parse({
      ...fixture,
      exchanges: fixture.exchanges.map((entry, candidateIndex) =>
        candidateIndex === index
          ? { request: exchange.request, response: prunedResponse }
          : entry,
      ),
    });
    const preLedger: JsonProofLedgerEntry[] = [];
    let response = originalResponse;
    if (isDiscovery && !isDeepStrictEqual(prunedResponse, originalResponse)) {
      const candidateHash = sha256(
        `${options.evaluationIdentity ?? "fixed-response-v1"}\nunused-tools-v1\n${canonicalJson(
          asJsonValue({ fixture: prunedFixture, oracle }),
        )}`,
      );
      const cached = options.cache?.get(candidateHash);
      let candidateResult: CandidateResult;
      let durationMs: number;
      if (cached === undefined) {
        const began = Date.now();
        candidateResult = await evaluate(prunedFixture);
        durationMs = Date.now() - began;
        testCount += 1;
        options.cache?.set(candidateHash, {
          result: candidateResult,
          durationMs,
        });
      } else {
        candidateResult = cached.result;
        durationMs = cached.durationMs;
      }
      preLedger.push({
        candidateHash,
        operation: "remove-unused-tools",
        path: "/response/result/tools",
        result: candidateResult,
        valid: true,
        durationMs,
        cacheHit: cached !== undefined,
      });
      if (candidateResult === "INTERESTING") response = prunedResponse;
    }
    const initial = {
      request: asJsonValue(exchange.request),
      response,
    } satisfies JsonValue;
    const elapsed = Date.now() - startedAt;
    if (testCount >= options.maxTests || elapsed >= options.maxDurationMs) {
      fixture.exchanges[index] = {
        request: exchange.request,
        response: response as ReplayFixture["exchanges"][number]["response"],
      };
      ledgers.push(preLedger);
      minimality = "budgetExhausted";
      break;
    }
    const remainingTests = options.maxTests - testCount;
    const remainingDuration = options.maxDurationMs - elapsed;
    const schemaExchange = {
      ...exchange,
      response: response as ReplayFixture["exchanges"][number]["response"],
    };
    const reduction = await minimizeJson(initial, {
      schema: exchangeSchema(schemaExchange, schemas, isDiscovery),
      maxTests: remainingTests,
      maxDurationMs: remainingDuration,
      ...(options.cache === undefined ? {} : { cache: options.cache }),
      cacheNamespace: sha256(
        JSON.stringify({
          fixture: input,
          oracle,
          stage: "json-v1",
          exchange: index,
          evaluationIdentity: options.evaluationIdentity ?? "fixed-response-v1",
        }),
      ),
      test: async (candidate) => {
        const container = candidate as { request: unknown; response: unknown };
        const candidateFixture = ReplayFixtureSchema.safeParse({
          ...fixture,
          exchanges: fixture.exchanges.map((entry, candidateIndex) =>
            candidateIndex === index
              ? { request: container.request, response: container.response }
              : entry,
          ),
        });
        if (!candidateFixture.success) return "UNRESOLVED";
        return evaluate(candidateFixture.data);
      },
    });
    testCount += reduction.testCount;
    ledgers.push([...preLedger, ...reduction.ledger]);
    if (reduction.minimality === "budgetExhausted")
      minimality = "budgetExhausted";
    const container = reduction.value as {
      request: ReplayFixture["exchanges"][number]["request"];
      response: ReplayFixture["exchanges"][number]["response"];
    };
    fixture.exchanges[index] = {
      request: container.request,
      response: container.response,
    };
    if (minimality === "budgetExhausted") break;
  }

  fixture = ReplayFixtureSchema.parse(fixture);
  const finalFieldCount = fixture.exchanges.reduce(
    (total, exchange) => total + measureJson(asJsonValue(exchange)).fieldCount,
    0,
  );
  return {
    fixture,
    ledgers,
    minimality,
    originalFieldCount,
    finalFieldCount,
    fieldReductionRate:
      originalFieldCount === 0 ? 0 : 1 - finalFieldCount / originalFieldCount,
    testCount,
  };
}
