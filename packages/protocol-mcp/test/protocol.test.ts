import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256 } from "@reprocore/format";
import {
  buildTransactions,
  createNormalizationState,
  getProtocolProfile,
  normalizeMcpFrame,
} from "../src/index.js";

function fixture(name: string): string[] {
  const path = fileURLToPath(
    new URL(`./fixtures/${name}.jsonl`, import.meta.url),
  );
  return readFileSync(path, "utf8").trim().split("\n");
}

describe("MCP protocol normalization", () => {
  it.each([
    ["legacy", "2025-11-25", "stateful"],
    ["modern", "2026-07-28", "stateless"],
  ] as const)(
    "preserves and recognizes the %s protocol",
    (name, version, lifecycle) => {
      const state = createNormalizationState();
      const events = fixture(name).map((line, sequence) => {
        const frame = Buffer.from(line);
        const direction =
          sequence % 2 === 0 ? "client_to_server" : "server_to_client";
        const normalized = normalizeMcpFrame(
          frame,
          direction,
          sequence,
          state,
          {
            timestamp: "2026-09-07T00:00:00.000Z",
          },
        );
        expect(normalized?.event.payloadRef).toBe(sha256(frame));
        return normalized?.event;
      });

      expect(state.protocolVersion).toBe(version);
      expect(getProtocolProfile(version).lifecycle).toBe(lifecycle);
      expect(events.every((event) => event !== undefined)).toBe(true);
    },
  );

  it("associates responses without changing string and numeric IDs", () => {
    const state = createNormalizationState();
    const events = fixture("legacy").flatMap((line, sequence) => {
      const direction =
        sequence === 0 || sequence === 2 || sequence === 3 || sequence === 5
          ? "client_to_server"
          : "server_to_client";
      const value = normalizeMcpFrame(
        Buffer.from(line),
        direction,
        sequence,
        state,
      );
      return value === undefined ? [] : [value.event];
    });
    const transactions = buildTransactions(events);

    expect(transactions).toHaveLength(4);
    expect(
      transactions.filter((transaction) => transaction.complete),
    ).toHaveLength(4);
    expect(events.at(-1)?.parentIds).toEqual([events.at(-2)?.eventId]);
    expect(events.at(-1)?.requestId).toBe(3);
  });
});
