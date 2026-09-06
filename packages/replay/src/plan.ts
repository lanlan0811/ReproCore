import { lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { z } from "zod";

export const PortableRelativePathSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    const normalized = value.replaceAll("\\", "/");
    if (
      isAbsolute(value) ||
      win32.isAbsolute(value) ||
      normalized.split("/").includes("..")
    ) {
      context.addIssue({
        code: "custom",
        message: "path must be portable and relative",
      });
    }
  });

export const FixtureActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("write_file"),
      path: PortableRelativePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("delay"),
      milliseconds: z.number().int().min(0).max(60_000),
    })
    .strict(),
  z
    .object({ kind: z.literal("exit"), code: z.number().int().min(0).max(255) })
    .strict(),
]);

export const GeneratedFixturePlanSchema = z
  .object({
    version: z.literal(1),
    files: z.record(PortableRelativePathSchema, z.string()).default({}),
    actions: z.array(FixtureActionSchema).default([]),
  })
  .strict();
export type GeneratedFixturePlan = z.infer<typeof GeneratedFixturePlanSchema>;

export class UnsafePathError extends Error {
  public constructor(path: string) {
    super(`Unsafe fixture path: ${path}`);
    this.name = "UnsafePathError";
  }
}

export function safeWorkspacePath(root: string, portablePath: string): string {
  const parsed = PortableRelativePathSchema.safeParse(portablePath);
  if (!parsed.success) throw new UnsafePathError(portablePath);
  const target = resolve(
    root,
    ...portablePath.replaceAll("\\", "/").split("/"),
  );
  const fromRoot = relative(resolve(root), target);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new UnsafePathError(portablePath);
  }

  let cursor = resolve(root);
  for (const part of fromRoot.split(sep).slice(0, -1)) {
    cursor = resolve(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink())
        throw new UnsafePathError(portablePath);
    } catch (error) {
      if (error instanceof UnsafePathError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
  return target;
}
