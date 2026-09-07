import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";

const PortableRelativePathSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    const normalized = value.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      /^[a-z]:/iu.test(normalized) ||
      normalized.split("/").includes("..")
    ) {
      context.addIssue({
        code: "custom",
        message: "path must be portable and relative",
      });
    }
  });

const ProcessExitRuleSchema = z
  .object({
    kind: z.literal("process_exit"),
    operator: z.enum(["equals", "not_equals"]),
    value: z.number().int(),
  })
  .strict();

const TimeoutRuleSchema = z
  .object({
    kind: z.literal("timeout"),
    timeoutMs: z.number().int().positive(),
  })
  .strict();

const JsonSchemaRuleSchema = z
  .object({
    kind: z.literal("json_schema_invalid"),
    target: z.enum(["last_request", "last_response"]).optional(),
    schema: z.record(z.string(), z.unknown()),
  })
  .strict();

const JsonPointerRuleSchema = z
  .object({
    kind: z.literal("json_pointer"),
    target: z.enum(["last_request", "last_response"]).optional(),
    pointer: z.string().startsWith("/"),
    operator: z.enum(["equals", "not_equals", "exists", "missing"]),
    value: z.unknown().optional(),
  })
  .strict();

const ToolCalledRuleSchema = z
  .object({ kind: z.literal("tool_called"), tool: z.string().min(1) })
  .strict();

const ForbiddenToolRuleSchema = z
  .object({ kind: z.literal("forbidden_tool"), tool: z.string().min(1) })
  .strict();

const FileHashRuleSchema = z
  .object({
    kind: z.literal("file_hash"),
    path: PortableRelativePathSchema,
    operator: z.enum(["equals", "not_equals"]),
    expected: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

const ForbiddenEffectRuleSchema = z
  .object({ kind: z.literal("forbidden_effect"), effect: z.string().min(1) })
  .strict();

const CustomScriptRuleSchema = z
  .object({
    kind: z.literal("custom_script"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  })
  .strict();

export const OracleRuleSchema = z.discriminatedUnion("kind", [
  ProcessExitRuleSchema,
  TimeoutRuleSchema,
  JsonSchemaRuleSchema,
  JsonPointerRuleSchema,
  ToolCalledRuleSchema,
  ForbiddenToolRuleSchema,
  FileHashRuleSchema,
  ForbiddenEffectRuleSchema,
  CustomScriptRuleSchema,
]);
export type OracleRule = z.infer<typeof OracleRuleSchema>;

export const OracleDocumentSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    repeat: z.number().int().min(1).max(100).default(3),
    mode: z.enum(["all", "any"]).default("all"),
    timeoutMs: z.number().int().positive().default(10_000),
    rules: z.array(OracleRuleSchema).min(1),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      document.rules.filter((rule) => rule.kind === "custom_script").length > 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["rules"],
        message: "only one custom_script rule is supported",
      });
    }
  });
export type OracleDocument = z.infer<typeof OracleDocumentSchema>;

export function readOracleDocument(path: string): OracleDocument {
  return OracleDocumentSchema.parse(parse(readFileSync(path, "utf8")));
}

export function createOracleTemplate(name: string): OracleDocument {
  return {
    version: 1,
    name,
    repeat: 3,
    mode: "all",
    timeoutMs: 10_000,
    rules: [{ kind: "process_exit", operator: "not_equals", value: 0 }],
  };
}

export function writeOracleDocument(
  path: string,
  document: OracleDocument,
): void {
  writeFileSync(path, stringify(OracleDocumentSchema.parse(document)), {
    encoding: "utf8",
    flag: "wx",
  });
}
