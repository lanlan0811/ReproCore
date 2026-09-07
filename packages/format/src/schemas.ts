import type { ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

export const FORMAT_VERSION = "1.0.0" as const;
export const FORMAT_MAJOR_VERSION = 1;

export const DirectionSchema = z.enum(["client_to_server", "server_to_client"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const SensitivitySchema = z.enum([
  "metadata",
  "content",
  "secret_candidate",
]);
export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const ReplayModeSchema = z.enum(["live", "fixture", "blocked"]);
export type ReplayMode = z.infer<typeof ReplayModeSchema>;

export const MinCaseEventSchema = z
  .object({
    eventId: z.string().min(1),
    timestamp: z.iso.datetime().optional(),
    channel: z.enum(["mcp", "process", "artifact", "oracle"]),
    direction: DirectionSchema.optional(),
    kind: z.string().min(1),
    protocolVersion: z.string().min(1).optional(),
    requestId: z.union([z.string(), z.number()]).optional(),
    parentIds: z.array(z.string()),
    payloadRef: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    schemaRef: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    sensitivity: SensitivitySchema,
    replayMode: ReplayModeSchema,
    payload: z.unknown().optional(),
  })
  .strict();
export type MinCaseEvent = z.infer<typeof MinCaseEventSchema>;

export const RawFrameRecordSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
    channel: z.enum(["stdout", "stderr", "stdin"]),
    direction: DirectionSchema.optional(),
    byteLength: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    contentBase64: z.string().optional(),
    summary: z.unknown().optional(),
  })
  .strict();
export type RawFrameRecord = z.infer<typeof RawFrameRecordSchema>;

export const ProtocolProfileSchema = z
  .object({
    id: z.enum(["legacy-2025-11-25", "modern-2026-07-28"]),
    protocolVersion: z.enum(["2025-11-25", "2026-07-28"]),
    lifecycle: z.enum(["stateful", "stateless"]),
    initializeRequired: z.boolean(),
    discoveryMethod: z.enum(["tools/list", "server/discover"]),
    loggingTransport: z.enum(["mcp", "stderr"]),
  })
  .strict();
export type ProtocolProfile = z.infer<typeof ProtocolProfileSchema>;

export const CandidateResultSchema = z.enum([
  "INTERESTING",
  "NOT_INTERESTING",
  "UNRESOLVED",
]);
export type CandidateResult = z.infer<typeof CandidateResultSchema>;

export const CaseTypeSchema = z.enum(["executable", "explanatory"]);
export type CaseType = z.infer<typeof CaseTypeSchema>;

export const MinimalitySchema = z.enum(["oneMinimal", "budgetExhausted"]);
export type Minimality = z.infer<typeof MinimalitySchema>;

const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const ArtifactHashesSchema = z
  .object({
    "package.json": ContentHashSchema,
    "provenance.json": ContentHashSchema,
    "redaction.yaml": ContentHashSchema,
    "report.html": ContentHashSchema,
    "runner/oracle.json": ContentHashSchema,
    "runner/regression.test.mjs": ContentHashSchema,
    "runner/replay-server.mjs": ContentHashSchema,
    "schemas/replay-fixture.schema.json": ContentHashSchema,
  })
  .strict();

export const MinCaseManifestSchema = z
  .object({
    formatVersion: z.string(),
    name: z.string().min(1),
    caseType: CaseTypeSchema,
    minimality: MinimalitySchema,
    protocolProfile: ProtocolProfileSchema,
    originalTransactionCount: z.number().int().nonnegative(),
    finalTransactionCount: z.number().int().nonnegative(),
    originalFieldCount: z.number().int().nonnegative(),
    finalFieldCount: z.number().int().nonnegative(),
    oracleHash: ContentHashSchema,
    fixtureHash: ContentHashSchema,
    proofHash: ContentHashSchema,
    traceHash: ContentHashSchema,
    artifactHashes: ArtifactHashesSchema,
    reducerSet: z.array(z.string()).min(1),
    baseline: z.object({
      repeat: z.number().int().positive(),
      passed: z.number().int().nonnegative(),
    }),
    finalVerification: z.object({
      repeat: z.number().int().positive(),
      passed: z.number().int().nonnegative(),
    }),
    redactionVerified: z.boolean(),
    sensitivity: SensitivitySchema,
    exportConfirmed: z.boolean(),
  })
  .strict();
export type MinCaseManifest = z.infer<typeof MinCaseManifestSchema>;

export class UnsupportedFormatVersionError extends Error {
  public constructor(version: string) {
    super(`Unsupported mincase format major version: ${version}`);
    this.name = "UnsupportedFormatVersionError";
  }
}

export function assertSupportedFormatVersion(version: string): void {
  const major = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
  if (!Number.isInteger(major) || major !== FORMAT_MAJOR_VERSION) {
    throw new UnsupportedFormatVersionError(version);
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

export function compileJsonSchema(schema: object): ValidateFunction {
  return ajv.compile(schema);
}
