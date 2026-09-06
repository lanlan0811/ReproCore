import { readFileSync } from "node:fs";
import { z } from "zod";

const JsonRpcMessageSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).optional(),
  })
  .catchall(z.unknown());

const ReplayObservationSeedSchema = z
  .object({
    exitCode: z.number().int().optional(),
    timedOut: z.boolean().optional(),
    durationMs: z.number().nonnegative().optional(),
    effects: z.array(z.string()).optional(),
  })
  .strict();

export const ReplayFixtureSchema = z
  .object({
    version: z.literal(1),
    protocolVersion: z.enum(["2025-11-25", "2026-07-28"]),
    exchanges: z
      .array(
        z
          .object({
            request: JsonRpcMessageSchema,
            response: JsonRpcMessageSchema,
          })
          .strict(),
      )
      .min(1),
    files: z.record(z.string(), z.string()).default({}),
    observation: ReplayObservationSeedSchema.default({}),
  })
  .strict();
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
export type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

export function readReplayFixture(path: string): ReplayFixture {
  return ReplayFixtureSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
