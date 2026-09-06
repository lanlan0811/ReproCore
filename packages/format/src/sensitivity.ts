import { sha256 } from "./serialization.js";

export type SecretKind =
  "api_key" | "authorization" | "cookie" | "oauth_code" | "private_key";

export interface SecretFinding {
  kind: SecretKind;
  offset: number;
}

const SECRET_RULES: ReadonlyArray<{ kind: SecretKind; pattern: RegExp }> = [
  {
    kind: "private_key",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/giu,
  },
  {
    kind: "authorization",
    pattern: /\b(?:authorization|bearer)\s*[:=]?\s*[a-z0-9._~+/=-]{16,}/giu,
  },
  {
    kind: "cookie",
    pattern: /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]{8,}/giu,
  },
  {
    kind: "oauth_code",
    pattern:
      /\b(?:oauth[_-]?code|code)["']?\s*[:=]\s*["']?[a-z0-9._~-]{12,}/giu,
  },
  {
    kind: "api_key",
    pattern:
      /\b(?:api[_-]?key|token|secret)["']?\s*[:=]\s*["']?[a-z0-9._~+/=-]{12,}/giu,
  },
  {
    kind: "api_key",
    pattern: /\b(?:sk|gh[pousr]|github_pat)_[a-z0-9_]{16,}/giu,
  },
];

export function scanSecretCandidates(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({ kind: rule.kind, offset: match.index });
    }
  }
  return findings.sort((left, right) => left.offset - right.offset);
}

export function summarizeValue(value: unknown): unknown {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.map((entry) => summarizeValue(entry)),
    };
  }
  if (typeof value === "object") {
    return {
      type: "object",
      fields: Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          summarizeValue(entry),
        ]),
      ),
    };
  }
  const serialized = String(value);
  return {
    type: typeof value,
    length: serialized.length,
    hash: sha256(serialized),
  };
}
