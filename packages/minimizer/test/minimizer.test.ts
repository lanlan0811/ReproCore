import { describe, expect, it } from "vitest";
import type { MinCaseEvent } from "@reprocore/format";
import type { McpTransaction } from "@reprocore/protocol-mcp";
import {
  buildTransactionDependencyGraph,
  dependencyClosure,
  minimizeTransactions,
  validateTransactionCandidate,
  type TransactionUnit,
} from "../src/index.js";

function event(overrides: Partial<MinCaseEvent>): MinCaseEvent {
  return {
    eventId: "event",
    channel: "mcp",
    kind: "request:tools/call",
    parentIds: [],
    sensitivity: "content",
    replayMode: "fixture",
    ...overrides,
  };
}

function transaction(id: string, events: MinCaseEvent[]): McpTransaction {
  return {
    transactionId: id,
    eventIds: events.map((item) => item.eventId),
    events,
    complete: true,
  };
}

describe("dependency graph", () => {
  it("keeps legacy lifecycle, discovery, explicit parents, and state handles", () => {
    const transactions = [
      transaction("init", [
        event({
          eventId: "init-request",
          kind: "request:initialize",
          protocolVersion: "2025-11-25",
        }),
      ]),
      transaction("list", [
        event({
          eventId: "list-request",
          kind: "request:tools/list",
          protocolVersion: "2025-11-25",
        }),
      ]),
      transaction("handle", [
        event({
          eventId: "handle-response",
          kind: "response:result",
          protocolVersion: "2025-11-25",
          payload: { result: { handle: "state-1" } },
        }),
      ]),
      transaction("call", [
        event({
          eventId: "call-request",
          kind: "request:tools/call",
          protocolVersion: "2025-11-25",
          parentIds: ["handle-response"],
          payload: { params: { handle: "state-1" } },
        }),
      ]),
    ];
    const graph = buildTransactionDependencyGraph(transactions);
    const closure = dependencyClosure(new Set(["call"]), graph);

    expect(closure).toEqual(new Set(["call", "handle", "list", "init"]));
    expect(validateTransactionCandidate(closure, transactions, graph)).toBe(
      true,
    );
  });
});

describe("transaction ddmin", () => {
  it("reduces a 40-transaction failure below ten while preserving dependencies", async () => {
    const units: TransactionUnit[] = Array.from({ length: 40 }, (_, index) => ({
      transactionId: `transaction-${index}`,
    }));
    const graph = new Map(
      units.map((unit) => [unit.transactionId, new Set<string>()] as const),
    );
    graph.get("transaction-39")!.add("transaction-0");

    const isFailure = (candidate: readonly TransactionUnit[]): boolean => {
      const ids = new Set(candidate.map((unit) => unit.transactionId));
      return (
        ids.has("transaction-0") &&
        ids.has("transaction-30") &&
        ids.has("transaction-39")
      );
    };
    const result = await minimizeTransactions(units, {
      dependencyGraph: graph,
      test: async (candidate) =>
        isFailure(candidate) ? "INTERESTING" : "NOT_INTERESTING",
    });

    expect(result.minimality).toBe("oneMinimal");
    expect(result.finalCount).toBe(3);
    expect(result.finalCount).toBeLessThan(10);
    expect(result.reductionRate).toBeGreaterThanOrEqual(0.7);
    expect(isFailure(result.transactions)).toBe(true);
    expect(result.ledger.length).toBeGreaterThan(1);
  });

  it("reports budget exhaustion instead of claiming one-minimal", async () => {
    const units = [{ transactionId: "one" }, { transactionId: "two" }];
    const result = await minimizeTransactions(units, {
      dependencyGraph: new Map(
        units.map((unit) => [unit.transactionId, new Set<string>()]),
      ),
      maxTests: 1,
      test: async () => "INTERESTING",
    });
    expect(result.minimality).toBe("budgetExhausted");
    expect(result.testCount).toBe(1);
  });

  it("filters invalid candidates before replay", async () => {
    const units = [
      { transactionId: "required" },
      { transactionId: "optional" },
    ];
    let replayCount = 0;
    const result = await minimizeTransactions(units, {
      dependencyGraph: new Map(
        units.map((unit) => [unit.transactionId, new Set<string>()]),
      ),
      validate: (candidate) =>
        candidate.some((unit) => unit.transactionId === "required"),
      test: async () => {
        replayCount += 1;
        return "INTERESTING";
      },
    });
    expect(result.transactions).toEqual([{ transactionId: "required" }]);
    expect(
      result.ledger.some(
        (entry) => !entry.valid && entry.result === "UNRESOLVED",
      ),
    ).toBe(true);
    expect(replayCount).toBeLessThan(result.testCount);
  });
});
