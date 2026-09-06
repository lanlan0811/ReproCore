import { describe, expect, it } from "vitest";
import { sha256 } from "@reprocore/format";
import { evaluateOracle, type OracleDocument } from "@reprocore/oracles";
import { runFixtureReplay, type ReplayFixture } from "@reprocore/replay";
import { minimizeTransactions, type TransactionUnit } from "../src/index.js";

interface ExchangeTransaction extends TransactionUnit {
  exchange: ReplayFixture["exchanges"][number];
}

describe("72-hour spike gate", () => {
  it("reduces 40 replay transactions by at least 70% and reproduces the file failure 5/5", async () => {
    const exchanges: ReplayFixture["exchanges"] = Array.from(
      { length: 40 },
      (_, index) => {
        const method =
          index === 0
            ? "server/discover"
            : index === 39
              ? "tools/call"
              : "prompts/get";
        const params =
          index === 39
            ? {
                name: "write_file",
                arguments: { target: { path: "wrong.md" } },
              }
            : {};
        return {
          request: { jsonrpc: "2.0" as const, id: index, method, params },
          response: { jsonrpc: "2.0" as const, id: index, result: { index } },
        };
      },
    );
    const fixture: ReplayFixture = {
      version: 1,
      protocolVersion: "2026-07-28",
      exchanges,
      files: { "fixtures/report.md": "wrong content" },
      observation: { exitCode: 0, effects: ["wrong_target_written"] },
    };
    const oracle: OracleDocument = {
      version: 1,
      name: "wrong-target-file",
      repeat: 3,
      mode: "all",
      timeoutMs: 10_000,
      rules: [
        { kind: "tool_called", tool: "write_file" },
        {
          kind: "file_hash",
          path: "fixtures/report.md",
          operator: "not_equals",
          expected: sha256("expected content"),
        },
        { kind: "forbidden_effect", effect: "wrong_target_written" },
      ],
    };
    const transactions: ExchangeTransaction[] = exchanges.map(
      (exchange, index) => ({
        transactionId: `exchange-${index}`,
        exchange,
      }),
    );
    const graph = new Map(
      transactions.map(
        (transaction) =>
          [transaction.transactionId, new Set<string>()] as const,
      ),
    );
    graph.get("exchange-39")!.add("exchange-0");

    const minimized = await minimizeTransactions(transactions, {
      dependencyGraph: graph,
      test: async (candidate) =>
        evaluateOracle(
          oracle,
          runFixtureReplay({
            ...fixture,
            exchanges: candidate.map((transaction) => transaction.exchange),
          }).observation,
        ).result,
    });
    const finalFixture: ReplayFixture = {
      ...fixture,
      exchanges: minimized.transactions.map(
        (transaction) => transaction.exchange,
      ),
    };
    const finalResults = Array.from({ length: 5 }, () =>
      evaluateOracle(oracle, runFixtureReplay(finalFixture).observation),
    );

    expect(minimized.finalCount).toBe(2);
    expect(minimized.reductionRate).toBeGreaterThanOrEqual(0.7);
    expect(minimized.minimality).toBe("oneMinimal");
    expect(
      finalResults.every((result) => result.result === "INTERESTING"),
    ).toBe(true);
  });
});
