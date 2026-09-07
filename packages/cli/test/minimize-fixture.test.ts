import { describe, expect, it, vi } from "vitest";
import { sha256 } from "@reprocore/format";
import { evaluateOracle, type OracleDocument } from "@reprocore/oracles";
import { runFixtureReplay, type ReplayFixture } from "@reprocore/replay";
import { minimizeFixtureJson } from "../src/minimize-fixture.js";

describe("fixture JSON minimization", () => {
  it("drops unused tools and fields while preserving the used Schema and Oracle", async () => {
    const tool = (name: string): Record<string, unknown> => ({
      name,
      description: `long description for ${name}`,
      inputSchema: {
        type: "object",
        required: ["target"],
        properties: {
          target: {
            type: "object",
            required: ["path"],
            properties: {
              path: { type: "string", minLength: 1 },
              note: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    });
    const fixture: ReplayFixture = {
      version: 1,
      protocolVersion: "2026-07-28",
      exchanges: [
        {
          request: {
            jsonrpc: "2.0",
            id: "discover",
            method: "server/discover",
            params: { verbose: true },
          },
          response: {
            jsonrpc: "2.0",
            id: "discover",
            result: {
              tools: [
                tool("read_file"),
                tool("delete_file"),
                tool("write_file"),
              ],
            },
          },
        },
        {
          request: {
            jsonrpc: "2.0",
            id: "write",
            method: "tools/call",
            params: {
              name: "write_file",
              arguments: { target: { path: "wrong.md", note: "unused note" } },
              requestMetadata: "unused",
            },
          },
          response: {
            jsonrpc: "2.0",
            id: "write",
            result: {
              structuredContent: { path: "wrong.md", detail: "unused" },
              extra: "unused",
            },
          },
        },
      ],
      files: { "fixtures/report.md": "wrong" },
      observation: { effects: [] },
    };
    const oracle: OracleDocument = {
      version: 1,
      name: "wrong-path",
      repeat: 3,
      mode: "all",
      timeoutMs: 10_000,
      rules: [
        { kind: "tool_called", tool: "write_file" },
        {
          kind: "json_pointer",
          target: "last_request",
          pointer: "/params/arguments/target/path",
          operator: "equals",
          value: "wrong.md",
        },
        {
          kind: "json_pointer",
          pointer: "/result/structuredContent/path",
          operator: "equals",
          value: "wrong.md",
        },
        {
          kind: "file_hash",
          path: "fixtures/report.md",
          operator: "equals",
          expected: sha256("wrong"),
        },
      ],
    };

    const result = await minimizeFixtureJson(fixture, oracle, {
      maxTests: 1_000,
      maxDurationMs: 30_000,
    });
    const discoveryResult = result.fixture.exchanges[0]!.response.result as {
      tools: Array<{ name: string }>;
    };
    const callParams = result.fixture.exchanges[1]!.request.params as Record<
      string,
      unknown
    >;

    expect(discoveryResult.tools.map((entry) => entry.name)).toEqual([
      "write_file",
    ]);
    expect(callParams).toEqual({
      name: "write_file",
      arguments: { target: { path: "wrong.md" } },
    });
    expect(result.fieldReductionRate).toBeGreaterThan(0.5);
    expect(result.minimality).toBe("oneMinimal");
    expect(
      evaluateOracle(oracle, runFixtureReplay(result.fixture).observation)
        .result,
    ).toBe("INTERESTING");
  });

  it("counts unused-tool checks against the global test budget", async () => {
    const fixture: ReplayFixture = {
      version: 1,
      protocolVersion: "2026-07-28",
      exchanges: [
        {
          request: {
            jsonrpc: "2.0",
            id: "discover",
            method: "server/discover",
          },
          response: {
            jsonrpc: "2.0",
            id: "discover",
            result: { tools: [{ name: "unused", inputSchema: {} }] },
          },
        },
      ],
      files: {},
      observation: {},
    };
    const oracle: OracleDocument = {
      version: 1,
      name: "budget",
      repeat: 3,
      mode: "all",
      timeoutMs: 10_000,
      rules: [{ kind: "process_exit", operator: "equals", value: 0 }],
    };
    const evaluate = vi.fn().mockResolvedValue("INTERESTING" as const);

    const result = await minimizeFixtureJson(fixture, oracle, {
      evaluate,
      evaluationIdentity: "docker-image@sha256:test",
      maxTests: 1,
      maxDurationMs: 30_000,
    });

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result.testCount).toBe(1);
    expect(result.minimality).toBe("budgetExhausted");
    expect(result.ledgers[0]?.[0]).toMatchObject({
      operation: "remove-unused-tools",
      cacheHit: false,
    });
    expect(
      (result.fixture.exchanges[0]?.response.result as { tools: unknown[] })
        .tools,
    ).toEqual([]);
  });
});
