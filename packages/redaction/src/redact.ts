import {
  scanSecretCandidates,
  sha256,
  type JsonValue,
  type SecretKind,
} from "@reprocore/format";
import { z } from "zod";
import {
  scanText,
  type RedactionFinding,
  type RedactionFindingKind,
} from "./scanner.js";

export interface RedactionSubstitution {
  kind: RedactionFindingKind;
  placeholder: string;
  fingerprint: string;
  locations: string[];
}

export interface RedactionProof {
  version: 1;
  passes: 2;
  verified: boolean;
  replayVerified: boolean;
  findings: RedactionFinding[];
  substitutions: RedactionSubstitution[];
}

const RedactionFindingKindSchema = z.enum([
  "api_key",
  "authorization",
  "cookie",
  "oauth_code",
  "private_key",
  "absolute_path",
  "email",
  "sensitive_field",
  "sensitive_query",
  "symlink",
  "unscanned_attachment",
]);

export const RedactionProofSchema: z.ZodType<RedactionProof> = z
  .object({
    version: z.literal(1),
    passes: z.literal(2),
    verified: z.boolean(),
    replayVerified: z.boolean(),
    findings: z.array(
      z
        .object({
          kind: RedactionFindingKindSchema,
          source: z.string(),
          location: z.string(),
          fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          blocking: z.boolean(),
        })
        .strict(),
    ),
    substitutions: z.array(
      z
        .object({
          kind: RedactionFindingKindSchema,
          placeholder: z.string().startsWith("<REDACTED_"),
          fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
          locations: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export interface RedactedDocuments {
  values: JsonValue[];
  proof: RedactionProof;
}

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|authorization|cookie|credential|oauth[_-]?code|password|secret|token)/iu;
const EMAIL_PATTERN =
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu;
const WINDOWS_PATH_PATTERN = /\b[a-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/giu;
const POSIX_PATH_PATTERN = /\/(?:Users|home|private|tmp|var)\/[^\s<>"']+/gu;
const QUERY_PATTERN =
  /([?&](?:access_token|api_key|auth|authorization|code|secret|token)=)([^&#\s]+)/giu;

class RedactionSession {
  readonly #substitutions = new Map<string, RedactionSubstitution>();
  readonly findings: RedactionFinding[] = [];

  public redact(value: JsonValue, source: string, path = "$"): JsonValue {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        this.redact(entry, source, `${path}[${index}]`),
      );
    }
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => {
          const location = `${path}.${key}`;
          if (SENSITIVE_KEY_PATTERN.test(key) && typeof entry === "string") {
            return [
              key,
              this.#replace(entry, "sensitive_field", source, location),
            ];
          }
          const redactedKey = this.#redactString(
            key,
            source,
            `${location}:key`,
          );
          return [redactedKey, this.redact(entry, source, location)];
        }),
      );
    }
    if (typeof value === "string")
      return this.#redactString(value, source, path);
    return value;
  }

  public substitutions(): RedactionSubstitution[] {
    return [...this.#substitutions.values()].sort((left, right) =>
      left.placeholder.localeCompare(right.placeholder),
    );
  }

  #replace(
    original: string,
    kind: RedactionFindingKind,
    source: string,
    location: string,
  ): string {
    const key = original;
    let substitution = this.#substitutions.get(key);
    if (substitution === undefined) {
      const count = this.#substitutions.size + 1;
      substitution = {
        kind,
        placeholder: `<REDACTED_${kind.toUpperCase()}_${count}>`,
        fingerprint: sha256(original),
        locations: [],
      };
      this.#substitutions.set(key, substitution);
    }
    if (!substitution.locations.includes(`${source}:${location}`)) {
      substitution.locations.push(`${source}:${location}`);
    }
    this.findings.push({
      kind,
      source,
      location,
      fingerprint: substitution.fingerprint,
      blocking: kind !== "email" && kind !== "absolute_path",
    });
    return substitution.placeholder;
  }

  #redactString(value: string, source: string, location: string): string {
    let output = value;
    for (const substitution of [...this.#substitutions.entries()].sort(
      ([left], [right]) => right.length - left.length,
    )) {
      const [original, replacement] = substitution;
      if (output.includes(original)) {
        output = output.replaceAll(
          original,
          this.#replace(original, replacement.kind, source, location),
        );
      }
    }
    output = output.replace(
      QUERY_PATTERN,
      (match, prefix: string, secret: string) =>
        match.replace(
          secret,
          this.#replace(secret, "sensitive_query", source, location),
        ),
    );
    for (const finding of scanSecretCandidates(output).sort(
      (left, right) => right.offset - left.offset,
    )) {
      const original = output.slice(
        finding.offset,
        finding.offset + finding.length,
      );
      output =
        output.slice(0, finding.offset) +
        this.#replace(original, finding.kind as SecretKind, source, location) +
        output.slice(finding.offset + finding.length);
    }
    output = output.replace(EMAIL_PATTERN, (match) =>
      this.#replace(match, "email", source, location),
    );
    output = output.replace(WINDOWS_PATH_PATTERN, (match) =>
      this.#replace(match, "absolute_path", source, location),
    );
    output = output.replace(POSIX_PATH_PATTERN, (match) =>
      this.#replace(match, "absolute_path", source, location),
    );
    return output;
  }
}

export function redactDocuments(
  values: readonly JsonValue[],
): RedactedDocuments {
  const session = new RedactionSession();
  const redacted = values.map((value, index) =>
    session.redact(value, `document-${index}`),
  );
  const secondPass = redacted.flatMap((value, index) =>
    scanText(JSON.stringify(value), `redacted-document-${index}`),
  );
  const blocking = secondPass.some((finding) => finding.blocking);
  return {
    values: redacted,
    proof: {
      version: 1,
      passes: 2,
      verified: !blocking,
      replayVerified: false,
      findings: [...session.findings, ...secondPass],
      substitutions: session.substitutions(),
    },
  };
}
