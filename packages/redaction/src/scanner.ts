import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  scanSecretCandidates,
  sha256,
  type SecretKind,
} from "@reprocore/format";

export type RedactionFindingKind =
  | SecretKind
  | "absolute_path"
  | "email"
  | "sensitive_field"
  | "sensitive_query"
  | "symlink"
  | "unscanned_attachment";

export interface RedactionFinding {
  kind: RedactionFindingKind;
  source: string;
  location: string;
  fingerprint: string;
  blocking: boolean;
}

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".diff",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".patch",
  ".txt",
  ".ts",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_FILENAMES = new Set([".env", ".gitconfig", ".npmrc", ".yarnrc"]);

const EMAIL_PATTERN =
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu;
const WINDOWS_PATH_PATTERN = /\b[a-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/giu;
const POSIX_PATH_PATTERN =
  /(?:^|\s)(\/(?:Users|home|private|tmp|var)\/[^\s<>"']+)/gu;
const QUERY_PATTERN =
  /[?&](?:access_token|api_key|auth|authorization|code|secret|token)=([^&#\s]+)/giu;

function findingsForPattern(
  text: string,
  pattern: RegExp,
  kind: RedactionFindingKind,
  source: string,
): RedactionFinding[] {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)]
    .filter((match) => !match[0].includes("<REDACTED_"))
    .map((match) => ({
      kind,
      source,
      location: `offset:${match.index}`,
      fingerprint: sha256(match[0]),
      blocking: kind !== "email" && kind !== "absolute_path",
    }));
}

export function scanText(text: string, source = "text"): RedactionFinding[] {
  const secretFindings: RedactionFinding[] = scanSecretCandidates(text).map(
    (finding) => ({
      kind: finding.kind,
      source,
      location: `offset:${finding.offset}`,
      fingerprint: sha256(
        text.slice(finding.offset, finding.offset + finding.length),
      ),
      blocking: true,
    }),
  );
  return [
    ...secretFindings,
    ...findingsForPattern(text, QUERY_PATTERN, "sensitive_query", source),
    ...findingsForPattern(text, EMAIL_PATTERN, "email", source),
    ...findingsForPattern(text, WINDOWS_PATH_PATTERN, "absolute_path", source),
    ...findingsForPattern(text, POSIX_PATH_PATTERN, "absolute_path", source),
  ].filter(
    (finding, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.kind === finding.kind &&
          candidate.source === finding.source &&
          candidate.location === finding.location,
      ) === index,
  );
}

function scanFile(path: string, source: string): RedactionFinding[] {
  if (
    !TEXT_EXTENSIONS.has(extname(path).toLowerCase()) &&
    !TEXT_FILENAMES.has(basename(path).toLowerCase())
  ) {
    return [
      {
        kind: "unscanned_attachment",
        source,
        location: "file",
        fingerprint: sha256(readFileSync(path)),
        blocking: true,
      },
    ];
  }
  const content = readFileSync(path);
  if (content.includes(0)) {
    return [
      {
        kind: "unscanned_attachment",
        source,
        location: "binary-content",
        fingerprint: sha256(content),
        blocking: true,
      },
    ];
  }
  return scanText(content.toString("utf8"), source);
}

export function scanPath(path: string): RedactionFinding[] {
  const root = resolve(path);
  if (lstatSync(root).isSymbolicLink()) {
    return [
      {
        kind: "symlink",
        source: basename(root),
        location: "file",
        fingerprint: sha256(root),
        blocking: true,
      },
    ];
  }
  if (!statSync(root).isDirectory()) return scanFile(root, basename(root));
  const findings: RedactionFinding[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const source = relative(root, absolute).split(sep).join("/");
      if (lstatSync(absolute).isSymbolicLink()) {
        findings.push({
          kind: "symlink",
          source,
          location: "file",
          fingerprint: sha256(source),
          blocking: true,
        });
      } else if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) findings.push(...scanFile(absolute, source));
    }
  };
  visit(root);
  return findings;
}

export function hasBlockingFindings(
  findings: readonly RedactionFinding[],
): boolean {
  return findings.some((finding) => finding.blocking);
}
