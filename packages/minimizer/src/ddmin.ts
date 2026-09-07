import {
  sha256,
  type CandidateResult,
  type Minimality,
} from "@reprocore/format";
import { dependencyClosure, type DependencyGraph } from "./dependencies.js";
import type { CandidateCacheLike } from "./cache.js";

export interface TransactionUnit {
  transactionId: string;
}

export interface ProofLedgerEntry {
  candidateHash: string;
  transactionIds: string[];
  removedIds: string[];
  result: CandidateResult;
  valid: boolean;
  durationMs: number;
  cacheHit: boolean;
}

export interface MinimizeOptions<T extends TransactionUnit> {
  dependencyGraph: DependencyGraph;
  test: (candidate: readonly T[]) => Promise<CandidateResult>;
  validate?: (candidate: readonly T[]) => boolean;
  maxTests?: number;
  maxDurationMs?: number;
  cache?: CandidateCacheLike;
  cacheNamespace?: string;
}

export interface MinimizeResult<T extends TransactionUnit> {
  transactions: T[];
  ledger: ProofLedgerEntry[];
  minimality: Minimality;
  originalCount: number;
  finalCount: number;
  reductionRate: number;
  testCount: number;
}

function split<T>(items: readonly T[], parts: number): T[][] {
  const size = Math.ceil(items.length / parts);
  return Array.from({ length: parts }, (_, index) =>
    items.slice(index * size, Math.min(items.length, (index + 1) * size)),
  ).filter((part) => part.length > 0);
}

function sameIds<T extends TransactionUnit>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (transaction, index) =>
        transaction.transactionId === right[index]?.transactionId,
    )
  );
}

export async function minimizeTransactions<T extends TransactionUnit>(
  original: readonly T[],
  options: MinimizeOptions<T>,
): Promise<MinimizeResult<T>> {
  const startedAt = Date.now();
  const maxTests = options.maxTests ?? 10_000;
  const maxDurationMs = options.maxDurationMs ?? 10 * 60 * 1_000;
  const ledger: ProofLedgerEntry[] = [];
  let testCount = 0;
  let budgetExhausted = false;
  let current = [...original];
  const originalOrder = new Map(
    original.map((transaction, index) => [transaction.transactionId, index]),
  );

  const closeCandidate = (candidate: readonly T[]): T[] => {
    const closedIds = dependencyClosure(
      new Set(candidate.map((transaction) => transaction.transactionId)),
      options.dependencyGraph,
    );
    return original
      .filter((transaction) => closedIds.has(transaction.transactionId))
      .sort(
        (left, right) =>
          (originalOrder.get(left.transactionId) ?? 0) -
          (originalOrder.get(right.transactionId) ?? 0),
      );
  };

  const evaluate = async (
    candidate: readonly T[],
    removedIds: string[],
  ): Promise<CandidateResult> => {
    const candidateHash = sha256(
      `${options.cacheNamespace ?? "transactions-v1"}\n${candidate
        .map((item) => item.transactionId)
        .join("\n")}`,
    );
    const cached = options.cache?.get(candidateHash);
    if (cached !== undefined) {
      ledger.push({
        candidateHash,
        transactionIds: candidate.map((item) => item.transactionId),
        removedIds,
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
    const valid = options.validate?.(candidate) ?? true;
    const candidateResult = valid
      ? await options.test(candidate)
      : "UNRESOLVED";
    testCount += 1;
    ledger.push({
      candidateHash,
      transactionIds: candidate.map((item) => item.transactionId),
      removedIds,
      result: candidateResult,
      valid,
      durationMs: Date.now() - began,
      cacheHit: false,
    });
    if (valid) {
      options.cache?.set(candidateHash, {
        result: candidateResult,
        durationMs: Date.now() - began,
      });
    }
    return candidateResult;
  };

  if ((await evaluate(current, [])) !== "INTERESTING") {
    return {
      transactions: current,
      ledger,
      minimality: "budgetExhausted",
      originalCount: original.length,
      finalCount: current.length,
      reductionRate: 0,
      testCount,
    };
  }

  let granularity = 2;
  while (current.length >= 2 && !budgetExhausted) {
    let reduced = false;
    for (const part of split(current, granularity)) {
      const removed = new Set(
        part.map((transaction) => transaction.transactionId),
      );
      const candidate = closeCandidate(
        current.filter(
          (transaction) => !removed.has(transaction.transactionId),
        ),
      );
      if (sameIds(candidate, current)) continue;
      if ((await evaluate(candidate, [...removed])) === "INTERESTING") {
        current = candidate;
        granularity = Math.max(2, granularity - 1);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (granularity >= current.length) break;
      granularity = Math.min(current.length, granularity * 2);
    }
  }

  let changed = true;
  while (changed && !budgetExhausted) {
    changed = false;
    for (const transaction of current) {
      const candidate = closeCandidate(
        current.filter(
          (entry) => entry.transactionId !== transaction.transactionId,
        ),
      );
      if (sameIds(candidate, current)) continue;
      if (
        (await evaluate(candidate, [transaction.transactionId])) ===
        "INTERESTING"
      ) {
        current = candidate;
        changed = true;
        break;
      }
    }
  }

  return {
    transactions: current,
    ledger,
    minimality: budgetExhausted ? "budgetExhausted" : "oneMinimal",
    originalCount: original.length,
    finalCount: current.length,
    reductionRate:
      original.length === 0 ? 0 : 1 - current.length / original.length,
    testCount,
  };
}
