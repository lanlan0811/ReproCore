import { describe, expect, it } from "vitest";
import {
  assertSupportedFormatVersion,
  canonicalJson,
  MinCaseEventSchema,
  scanSecretCandidates,
  sha256,
  summarizeValue,
  UnsupportedFormatVersionError,
} from "../src/index.js";

describe("format contracts", () => {
  it("serializes object keys deterministically", () => {
    expect(canonicalJson({ zebra: 1, alpha: [true, null] })).toBe(
      '{"alpha":[true,null],"zebra":1}',
    );
  });

  it("rejects unknown format major versions", () => {
    expect(() => assertSupportedFormatVersion("2.0.0")).toThrow(
      UnsupportedFormatVersionError,
    );
    expect(() => assertSupportedFormatVersion("1.9.0")).not.toThrow();
  });

  it("validates normalized events and content hashes", () => {
    expect(
      MinCaseEventSchema.parse({
        eventId: "event-1",
        channel: "mcp",
        kind: "request:tools/list",
        parentIds: [],
        payloadRef: sha256("{}"),
        sensitivity: "metadata",
        replayMode: "fixture",
      }),
    ).toBeDefined();
  });

  it("summarizes values without retaining scalar content", () => {
    const summary = summarizeValue({ password: "not-a-real-password" });
    expect(JSON.stringify(summary)).not.toContain("not-a-real-password");
  });

  it("detects common credential shapes", () => {
    expect(
      scanSecretCandidates("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"),
    ).toEqual([expect.objectContaining({ kind: "authorization" })]);
    expect(scanSecretCandidates('{"api_key":"abcdefghijklmnop"}')).toEqual([
      expect.objectContaining({ kind: "api_key" }),
    ]);
    expect(scanSecretCandidates("ordinary text")).toHaveLength(0);
  });
});
