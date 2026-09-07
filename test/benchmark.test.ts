import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CandidateResult,
  JsonValue,
} from "../packages/format/src/index.js";
import {
  minimizeJson,
  minimizeTransactions,
  type DependencyGraph,
  type TransactionUnit,
} from "../packages/minimizer/src/index.js";
import {
  evaluateOracle,
  OracleDocumentSchema,
  type OracleDocument,
  type OracleObservation,
} from "../packages/oracles/src/index.js";
import {
  ReplayFixtureSchema,
  verifyBaseline,
} from "../packages/replay/src/index.js";

interface SeedManifest {
  seeds: number[];
  oracleRotation: string[];
  acceptance: {
    seededFailureRetentionRate: number;
    normalFalsePositiveRate: number;
    medianTransactionReductionRate: number;
    medianJsonFieldReductionRate: number;
    maximumDurationMs: number;
  };
}

interface PublicCaseManifest {
  cases: Array<{
    id: string;
    license: string;
    sourceUrl: string;
    fixture: unknown;
    oracle: unknown;
  }>;
}

interface SeedTransaction extends TransactionUnit {
  failure: boolean;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted[middle - 1] ?? sorted[middle] ?? 0;
  const right = sorted[middle] ?? left;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

function oracleFor(seed: number): OracleDocument {
  const common = {
    version: 1 as const,
    name: `seed-${seed}`,
    repeat: 3,
    mode: "all" as const,
    timeoutMs: 10_000,
  };
  switch ((seed - 1) % 6) {
    case 0:
      return {
        ...common,
        rules: [{ kind: "process_exit", operator: "not_equals", value: 0 }],
      };
    case 1:
      return { ...common, rules: [{ kind: "timeout", timeoutMs: 100 }] };
    case 2:
      return {
        ...common,
        rules: [
          {
            kind: "json_schema_invalid",
            schema: {
              type: "object",
              required: ["ok"],
              properties: { ok: { type: "boolean" } },
            },
          },
        ],
      };
    case 3:
      return {
        ...common,
        rules: [
          {
            kind: "file_hash",
            path: "result.txt",
            operator: "not_equals",
            expected: `sha256:${"a".repeat(64)}`,
          },
        ],
      };
    case 4:
      return {
        ...common,
        rules: [{ kind: "forbidden_tool", tool: "delete_file" }],
      };
    default:
      return {
        ...common,
        rules: [{ kind: "forbidden_effect", effect: "outside_write" }],
      };
  }
}

function observationFor(seed: number, failing: boolean): OracleObservation {
  switch ((seed - 1) % 6) {
    case 0:
      return { exitCode: failing ? 1 : 0 };
    case 1:
      return { timedOut: failing, durationMs: failing ? 101 : 10 };
    case 2:
      return { messages: [{ ok: failing ? "wrong" : true }] };
    case 3:
      return {
        fileHashes: {
          "result.txt": `sha256:${(failing ? "b" : "a").repeat(64)}`,
        },
      };
    case 4:
      return { toolCalls: failing ? ["delete_file"] : ["read_file"] };
    default:
      return { effects: failing ? ["outside_write"] : [] };
  }
}

describe("MVP acceptance benchmark", () => {
  it("meets all seeded-failure reduction and accuracy gates", async () => {
    const manifest = loadJson<SeedManifest>("benchmarks/seeded-failures.json");
    const startedAt = Date.now();
    const transactionRates: number[] = [];
    const fieldRates: number[] = [];
    let retained = 0;
    let falsePositives = 0;

    for (const seed of manifest.seeds) {
      const oracle = oracleFor(seed);
      const legacy = seed % 2 === 0;
      const setupIds = legacy ? ["initialize", "discover"] : ["discover"];
      const failureId = `failure-${seed}`;
      const transactions: SeedTransaction[] = Array.from(
        { length: 30 + seed },
        (_, index) => ({
          transactionId:
            setupIds[index] ??
            (index === 2 ? failureId : `noise-${seed}-${index}`),
          failure: index === 2,
        }),
      );
      const graph: DependencyGraph = new Map(
        transactions.map((transaction) => [
          transaction.transactionId,
          new Set(transaction.failure ? setupIds : []),
        ]),
      );
      const minimized = await minimizeTransactions(transactions, {
        dependencyGraph: graph,
        test: async (candidate) =>
          evaluateOracle(
            oracle,
            observationFor(
              seed,
              candidate.some((entry) => entry.failure),
            ),
          ).result,
      });
      transactionRates.push(minimized.reductionRate);

      const payload: JsonValue = {
        target: "wrong.md",
        mode: "unsafe",
        attempt: seed,
        tags: ["alpha", "beta", "gamma"],
        metadata: { owner: "benchmark", seed, trace: `trace-${seed}` },
        noiseA: "remove-me",
        noiseB: true,
        noiseC: 999,
      };
      const minimizedJson = await minimizeJson(payload, {
        schema: {
          type: "object",
          required: ["target"],
          properties: { target: { const: "wrong.md" } },
        },
        test: async (candidate): Promise<CandidateResult> =>
          typeof candidate === "object" &&
          candidate !== null &&
          !Array.isArray(candidate) &&
          candidate.target === "wrong.md"
            ? "INTERESTING"
            : "NOT_INTERESTING",
      });
      fieldRates.push(minimizedJson.fieldReductionRate);

      if (
        minimized.minimality === "oneMinimal" &&
        minimizedJson.minimality === "oneMinimal" &&
        evaluateOracle(
          oracle,
          observationFor(
            seed,
            minimized.transactions.some((entry) => entry.failure),
          ),
        ).result === "INTERESTING"
      ) {
        retained += 1;
      }
      if (
        evaluateOracle(oracle, observationFor(seed, false)).result ===
        "INTERESTING"
      ) {
        falsePositives += 1;
      }
    }

    const durationMs = Date.now() - startedAt;
    const retentionRate = retained / manifest.seeds.length;
    const falsePositiveRate = falsePositives / manifest.seeds.length;
    const medianTransactionRate = median(transactionRates);
    const medianFieldRate = median(fieldRates);
    process.stdout.write(
      `${JSON.stringify({ retentionRate, falsePositiveRate, medianTransactionRate, medianFieldRate, durationMs })}\n`,
    );

    expect(manifest.seeds).toHaveLength(30);
    expect(manifest.oracleRotation).toHaveLength(6);
    expect(retentionRate).toBeGreaterThanOrEqual(
      manifest.acceptance.seededFailureRetentionRate,
    );
    expect(falsePositiveRate).toBeLessThanOrEqual(
      manifest.acceptance.normalFalsePositiveRate,
    );
    expect(medianTransactionRate).toBeGreaterThanOrEqual(
      manifest.acceptance.medianTransactionReductionRate,
    );
    expect(medianFieldRate).toBeGreaterThanOrEqual(
      manifest.acceptance.medianJsonFieldReductionRate,
    );
    expect(durationMs).toBeLessThan(manifest.acceptance.maximumDurationMs);
  });

  it("validates and reproduces five license-attributed public adaptations", () => {
    const manifest = loadJson<PublicCaseManifest>(
      "benchmarks/public-cases.json",
    );
    expect(manifest.cases).toHaveLength(5);
    for (const publicCase of manifest.cases) {
      expect(publicCase.license).toMatch(/Apache-2\.0|MIT/u);
      expect(publicCase.sourceUrl).toMatch(/^https:\/\/github\.com\//u);
      const fixture = ReplayFixtureSchema.parse(publicCase.fixture);
      const oracle = OracleDocumentSchema.parse(publicCase.oracle);
      expect(verifyBaseline(fixture, oracle, 3).status, publicCase.id).toBe(
        "STABLE",
      );
    }
  });
});
