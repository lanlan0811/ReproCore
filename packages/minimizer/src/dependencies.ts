import { canonicalJson, type JsonValue } from "@reprocore/format";
import type { McpTransaction } from "@reprocore/protocol-mcp";

export type DependencyGraph = ReadonlyMap<string, ReadonlySet<string>>;

const STATE_REFERENCE_KEYS = new Set([
  "authorizationId",
  "confirmationId",
  "handle",
  "progressToken",
  "taskId",
]);

function collectStateReferences(
  value: unknown,
  target: Map<string, Set<string>>,
  transactionId: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value)
      collectStateReferences(item, target, transactionId);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (STATE_REFERENCE_KEYS.has(key) && item !== undefined) {
      const serialized = canonicalJson(item as JsonValue);
      const transactions = target.get(serialized) ?? new Set<string>();
      transactions.add(transactionId);
      target.set(serialized, transactions);
    }
    collectStateReferences(item, target, transactionId);
  }
}

export function buildTransactionDependencyGraph(
  transactions: readonly McpTransaction[],
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>(
    transactions.map((transaction) => [
      transaction.transactionId,
      new Set<string>(),
    ]),
  );
  const eventToTransaction = new Map<string, string>();
  const schemaProducer = new Map<string, string>();
  let initializeTransaction: string | undefined;
  let discoveryTransaction: string | undefined;
  const stateProducers = new Map<string, Set<string>>();

  for (const transaction of transactions) {
    for (const event of transaction.events) {
      eventToTransaction.set(event.eventId, transaction.transactionId);
    }
  }

  for (const transaction of transactions) {
    const dependencies = graph.get(transaction.transactionId)!;
    for (const event of transaction.events) {
      for (const parentId of event.parentIds) {
        const parentTransaction = eventToTransaction.get(parentId);
        if (
          parentTransaction !== undefined &&
          parentTransaction !== transaction.transactionId
        ) {
          dependencies.add(parentTransaction);
        }
      }

      if (event.kind === "request:initialize")
        initializeTransaction = transaction.transactionId;
      if (
        event.kind === "request:tools/list" ||
        event.kind === "request:server/discover"
      ) {
        discoveryTransaction = transaction.transactionId;
      }
      if (
        event.kind === "request:tools/call" &&
        discoveryTransaction !== undefined
      ) {
        dependencies.add(discoveryTransaction);
      }
      if (
        event.protocolVersion === "2025-11-25" &&
        event.kind !== "request:initialize" &&
        initializeTransaction !== undefined
      ) {
        dependencies.add(initializeTransaction);
      }
      if (event.schemaRef !== undefined) {
        const producer = schemaProducer.get(event.schemaRef);
        if (producer !== undefined && producer !== transaction.transactionId) {
          dependencies.add(producer);
        } else {
          schemaProducer.set(event.schemaRef, transaction.transactionId);
        }
      }

      const references = new Map<string, Set<string>>();
      collectStateReferences(
        event.payload,
        references,
        transaction.transactionId,
      );
      for (const [reference, consumers] of references) {
        const producers = stateProducers.get(reference);
        if (event.kind.startsWith("request:") && producers !== undefined) {
          for (const producer of producers) {
            if (producer !== transaction.transactionId)
              dependencies.add(producer);
          }
        }
        if (event.kind.startsWith("response:")) {
          const existing = stateProducers.get(reference) ?? new Set<string>();
          for (const consumer of consumers) existing.add(consumer);
          stateProducers.set(reference, existing);
        }
      }
    }
  }
  return graph;
}

export function dependencyClosure(
  selected: ReadonlySet<string>,
  graph: DependencyGraph,
): Set<string> {
  const closure = new Set(selected);
  const pending = [...selected];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const dependency of graph.get(current) ?? []) {
      if (!closure.has(dependency)) {
        closure.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return closure;
}

export function validateTransactionCandidate(
  selected: ReadonlySet<string>,
  transactions: readonly McpTransaction[],
  graph: DependencyGraph,
): boolean {
  const byId = new Map(
    transactions.map((transaction) => [transaction.transactionId, transaction]),
  );
  for (const transactionId of selected) {
    const transaction = byId.get(transactionId);
    if (transaction === undefined || !transaction.complete) return false;
    for (const dependency of graph.get(transactionId) ?? []) {
      if (!selected.has(dependency)) return false;
    }
  }
  return true;
}
