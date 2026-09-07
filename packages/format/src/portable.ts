import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { zipSync, type Zippable } from "fflate";
import { parse } from "yaml";
import {
  assertSupportedFormatVersion,
  MinCaseManifestSchema,
  type MinCaseManifest,
} from "./schemas.js";

const REQUIRED_CASE_FILES = [
  "manifest.yaml",
  "oracle.yaml",
  "package.json",
  "provenance.json",
  "redaction.yaml",
  "report.html",
  "trace.jsonl",
  "artifacts/proof.json",
  "fixtures/replay.json",
  "runner/oracle.json",
  "runner/regression.test.mjs",
  "runner/replay-server.mjs",
  "schemas/replay-fixture.schema.json",
] as const;

const ALLOWED_CASE_FILES = new Set<string>(REQUIRED_CASE_FILES);
const ALLOWED_TOP_LEVEL = new Set(
  REQUIRED_CASE_FILES.map((path) => path.split("/", 1)[0]),
);

const FORBIDDEN_EXPORT_NAMES = [
  /^raw-frames\.jsonl$/iu,
  /\.sqlite(?:3)?$/iu,
  /\.db$/iu,
  /^candidates?/iu,
  /^original-session/iu,
];

const ZIP_TIMESTAMP = new Date("1980-01-01T00:00:00.000Z");

export class InvalidMinCaseDirectoryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidMinCaseDirectoryError";
  }
}

export function validateCaseName(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(name)) {
    throw new InvalidMinCaseDirectoryError(
      "case name must contain only lowercase letters, numbers, dots, underscores, or hyphens",
    );
  }
  return name;
}

function collectCaseFiles(root: string, directory = root): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink()) {
      throw new InvalidMinCaseDirectoryError(
        `symbolic links are not exportable: ${entry.name}`,
      );
    }
    const absolute = join(directory, entry.name);
    const portable = relative(root, absolute).split(sep).join("/");
    if (FORBIDDEN_EXPORT_NAMES.some((pattern) => pattern.test(entry.name))) {
      throw new InvalidMinCaseDirectoryError(
        `forbidden export file: ${portable}`,
      );
    }
    if (entry.isDirectory()) {
      for (const [path, content] of collectCaseFiles(root, absolute))
        files.set(path, content);
    } else if (entry.isFile()) {
      files.set(portable, readFileSync(absolute));
    }
  }
  return files;
}

export function readMinCaseManifest(caseDirectory: string): MinCaseManifest {
  const manifest = MinCaseManifestSchema.parse(
    parse(readFileSync(join(caseDirectory, "manifest.yaml"), "utf8")),
  );
  assertSupportedFormatVersion(manifest.formatVersion);
  return manifest;
}

export function validateMinCaseDirectory(
  caseDirectory: string,
): Map<string, Buffer> {
  const root = resolve(caseDirectory);
  if (!basename(root).endsWith(".mincase")) {
    throw new InvalidMinCaseDirectoryError(
      "working case directory must end with .mincase",
    );
  }
  const topLevel = readdirSync(root, { withFileTypes: true });
  for (const entry of topLevel) {
    if (!ALLOWED_TOP_LEVEL.has(entry.name)) {
      throw new InvalidMinCaseDirectoryError(
        `unexpected top-level entry: ${entry.name}`,
      );
    }
  }
  const files = collectCaseFiles(root);
  for (const path of files.keys()) {
    if (!ALLOWED_CASE_FILES.has(path)) {
      throw new InvalidMinCaseDirectoryError(`unexpected case file: ${path}`);
    }
  }
  for (const required of REQUIRED_CASE_FILES) {
    if (!files.has(required)) {
      throw new InvalidMinCaseDirectoryError(
        `required case file is missing: ${required}`,
      );
    }
  }
  readMinCaseManifest(root);
  return files;
}

export function createDeterministicMinCaseZip(
  caseDirectory: string,
  outputPath: string,
): void {
  const files = validateMinCaseDirectory(caseDirectory);
  const rootName = basename(resolve(caseDirectory));
  const archive: Zippable = {};
  for (const [path, content] of [...files].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    archive[`${rootName}/${path}`] = [content, { mtime: ZIP_TIMESTAMP }];
  }
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), zipSync(archive, { level: 9 }), {
    flag: "wx",
  });
}
