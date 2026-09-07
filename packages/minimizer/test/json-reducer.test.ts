import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue } from "@reprocore/format";
import {
  CandidateCache,
  minimizeJson,
  minimizeTransactions,
  removeUnusedToolDefinitions,
} from "../src/index.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("Schema-aware JSON reduction", () => {
  it("reduces keys, arrays, strings, numbers, enums, and composed schemas to fixpoint", async () => {
    const original: JsonValue = {
      mode: "verbose",
      payload: {
        trigger: "BUG-extra-context",
        unused: "remove me",
        unusedTwo: "remove me too",
        numbers: [99, 88, 77],
      },
      unusedTopLevel: true,
    };
    const schema = {
      allOf: [
        {
          type: "object",
          required: ["mode", "payload"],
          properties: {
            mode: {
              oneOf: [{ const: "verbose" }, { const: "v" }],
              enum: ["verbose", "v"],
            },
            payload: {
              type: "object",
              required: ["trigger", "numbers"],
              properties: {
                trigger: { type: "string", minLength: 3 },
                numbers: {
                  type: "array",
                  minItems: 1,
                  items: { type: "integer", minimum: 0 },
                },
                unused: { type: "string" },
                unusedTwo: { type: "string" },
              },
              additionalProperties: false,
            },
            unusedTopLevel: { type: "boolean" },
          },
          additionalProperties: false,
        },
      ],
    };
    const result = await minimizeJson(original, {
      schema,
      test: async (candidate) => {
        const payload = (candidate as Record<string, JsonValue>)
          .payload as Record<string, JsonValue>;
        return typeof payload.trigger === "string" &&
          payload.trigger.includes("BUG")
          ? "INTERESTING"
          : "NOT_INTERESTING";
      },
    });

    expect(result.value).toEqual({
      mode: "v",
      payload: { trigger: "BUG", numbers: [0] },
    });
    expect(result.fieldReductionRate).toBeGreaterThanOrEqual(0.5);
    expect(result.minimality).toBe("oneMinimal");
    expect(
      result.ledger.some((entry) => entry.operation === "delete-object-key"),
    ).toBe(true);
    expect(
      result.ledger.some((entry) => entry.operation === "delete-array-item"),
    ).toBe(true);
    expect(
      result.ledger.some((entry) => entry.operation === "reduce-enum"),
    ).toBe(true);
    expect(
      result.ledger.some((entry) => entry.operation === "reduce-string"),
    ).toBe(true);
    expect(
      result.ledger.some((entry) => entry.operation === "reduce-number"),
    ).toBe(true);
  });

  it("removes unused tool definitions while retaining full used definitions", () => {
    const message: JsonValue = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "read_file", inputSchema: { type: "object" } },
          { name: "write_file", inputSchema: { type: "object" } },
        ],
      },
    };
    expect(
      removeUnusedToolDefinitions(message, new Set(["write_file"])),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "write_file", inputSchema: { type: "object" } }],
      },
    });
  });

  it("reuses persistent SQLite candidate results", async () => {
    const directory = mkdtempSync(join(tmpdir(), "reprocore-cache-"));
    cleanupPaths.push(directory);
    const path = join(directory, "candidates.sqlite");
    const units = [
      { transactionId: "required" },
      { transactionId: "optional" },
    ];
    const graph = new Map(
      units.map((unit) => [unit.transactionId, new Set<string>()]),
    );
    let executions = 0;
    const run = async (): Promise<void> => {
      using cache = new CandidateCache(path);
      await minimizeTransactions(units, {
        dependencyGraph: graph,
        cache,
        cacheNamespace: "cache-test",
        test: async (candidate) => {
          executions += 1;
          return candidate.some((unit) => unit.transactionId === "required")
            ? "INTERESTING"
            : "NOT_INTERESTING";
        },
      });
    };

    await run();
    const firstExecutions = executions;
    await run();
    expect(executions).toBe(firstExecutions);
  });
});
