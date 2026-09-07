import { describe, expect, it } from "vitest";
import type { MinCaseManifest } from "@reprocore/format";
import type { RedactionProof } from "@reprocore/redaction";
import { generateStaticReport } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

function manifest(name: string): MinCaseManifest {
  return {
    formatVersion: "1.0.0",
    name,
    caseType: "executable",
    minimality: "oneMinimal",
    protocolProfile: {
      id: "modern-2026-07-28",
      protocolVersion: "2026-07-28",
      lifecycle: "stateless",
      initializeRequired: false,
      discoveryMethod: "server/discover",
      loggingTransport: "stderr",
    },
    originalTransactionCount: 40,
    finalTransactionCount: 2,
    originalFieldCount: 100,
    finalFieldCount: 20,
    oracleHash: hash,
    fixtureHash: hash,
    proofHash: hash,
    traceHash: hash,
    reducerSet: ["transaction-ddmin-v1"],
    baseline: { repeat: 3, passed: 3 },
    finalVerification: { repeat: 5, passed: 5 },
    redactionVerified: true,
    sensitivity: "content",
    exportConfirmed: true,
  };
}

describe("static HTML report", () => {
  it("escapes untrusted values and remains script-free with a strict CSP", () => {
    const proof = {
      transaction: {
        ledger: [{ removedIds: ['"><img src=x onerror=alert(1)>'] }],
      },
    };
    const redaction: RedactionProof = {
      version: 1,
      passes: 2,
      verified: true,
      replayVerified: true,
      findings: [],
      substitutions: [
        {
          kind: "email",
          placeholder: "<REDACTED_EMAIL_1>",
          fingerprint: hash,
          locations: ["document-0:$.contact"],
        },
      ],
    };
    const html = generateStaticReport({
      manifest: manifest('</style><script>alert("x")</script>'),
      proof,
      redaction,
    });

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<svg");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;REDACTED_EMAIL_1&gt;");
    expect(html).toContain("95.0% removed");
  });
});
