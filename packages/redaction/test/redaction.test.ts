import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { redactDocuments, scanPath, scanText } from "../src/index.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("redaction", () => {
  it("replaces credentials and personal data deterministically, then passes a second scan", () => {
    const secret = "github_pat_abcdefghijklmnopqrstuvwxyz";
    const home = "C:\\Users\\Ada\\private-project";
    const result = redactDocuments([
      {
        apiKey: secret,
        authorization: `Bearer ${secret}`,
        callback: `https://example.test/cb?token=${secret}`,
        contact: "ada@example.test",
        home,
        duplicateHome: home,
      },
      { expected: secret, diff: `+ token=${secret}` },
    ]);
    const serialized = JSON.stringify(result.values);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("ada@example.test");
    expect(serialized).not.toContain(home);
    expect(result.proof.verified).toBe(true);
    expect(result.proof.passes).toBe(2);
    expect(scanText(serialized)).toEqual([]);
    const paths = result.proof.substitutions.filter(
      (entry) => entry.kind === "absolute_path",
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]?.locations).toHaveLength(2);
    expect(JSON.stringify(result.proof)).not.toContain(secret);
  });

  it("reports only fingerprints and locations for secret candidates", () => {
    const secret = "sk_abcdefghijklmnopqrstuvwxyz123456";
    const findings = scanText(
      `authorization: Bearer ${secret}`,
      "request.json",
    );

    expect(findings.some((finding) => finding.blocking)).toBe(true);
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(
      findings.every((finding) => finding.fingerprint.startsWith("sha256:")),
    ).toBe(true);
  });

  it("removes an entire PEM private key instead of only its header", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "c3VwZXItc2VjcmV0LWtleS1tYXRlcmlhbA==",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = redactDocuments([{ privateKey }]);
    const serialized = JSON.stringify(result.values);

    expect(result.proof.verified).toBe(true);
    expect(serialized).not.toContain("c3VwZXItc2VjcmV0LWtleS1tYXRlcmlhbA");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  });

  it("blocks unscanned attachments while scanning known text files", () => {
    const root = mkdtempSync(join(tmpdir(), "reprocore-redaction-"));
    cleanupPaths.push(root);
    mkdirSync(join(root, "nested"));
    writeFileSync(
      join(root, "nested", "request.txt"),
      "cookie=session-abcdefghijklmnop\n",
    );
    writeFileSync(join(root, ".env"), "TOKEN=abcdefghijklmnop\n");
    writeFileSync(join(root, "capture.bin"), Buffer.from([0, 1, 2, 3]));

    const findings = scanPath(root);
    expect(findings.some((finding) => finding.kind === "cookie")).toBe(true);
    expect(findings.some((finding) => finding.source === ".env")).toBe(true);
    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: "unscanned_attachment",
        source: "capture.bin",
        blocking: true,
      }),
    );
  });
});
