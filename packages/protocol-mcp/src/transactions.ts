import type { MinCaseEvent } from "@reprocore/format";

export interface McpTransaction {
  transactionId: string;
  requestId?: string | number;
  eventIds: string[];
  events: MinCaseEvent[];
  complete: boolean;
}

function requestKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

export function buildTransactions(
  events: readonly MinCaseEvent[],
): McpTransaction[] {
  const transactions: McpTransaction[] = [];
  const byRequest = new Map<string, McpTransaction>();

  for (const event of events) {
    if (event.requestId === undefined) {
      transactions.push({
        transactionId: event.eventId,
        eventIds: [event.eventId],
        events: [event],
        complete: true,
      });
      continue;
    }

    const key = requestKey(event.requestId);
    if (event.kind.startsWith("request:")) {
      const transaction: McpTransaction = {
        transactionId: event.eventId,
        requestId: event.requestId,
        eventIds: [event.eventId],
        events: [event],
        complete: false,
      };
      byRequest.set(key, transaction);
      transactions.push(transaction);
      continue;
    }

    const transaction = byRequest.get(key);
    if (transaction === undefined) {
      transactions.push({
        transactionId: event.eventId,
        requestId: event.requestId,
        eventIds: [event.eventId],
        events: [event],
        complete: false,
      });
      continue;
    }
    transaction.events.push(event);
    transaction.eventIds.push(event.eventId);
    transaction.complete = true;
  }

  return transactions;
}
