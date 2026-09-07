import type { MinCaseManifest } from "@reprocore/format";
import type { RedactionProof } from "@reprocore/redaction";

export interface StaticReportInput {
  manifest: Pick<
    MinCaseManifest,
    | "baseline"
    | "caseType"
    | "finalFieldCount"
    | "finalTransactionCount"
    | "finalVerification"
    | "fixtureHash"
    | "minimality"
    | "name"
    | "oracleHash"
    | "originalFieldCount"
    | "originalTransactionCount"
    | "protocolProfile"
  >;
  proof: unknown;
  redaction: RedactionProof;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function percentage(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
}

function removedTransactionIds(proof: unknown): string[] {
  if (typeof proof !== "object" || proof === null) return [];
  const transaction = (proof as Record<string, unknown>).transaction;
  if (typeof transaction !== "object" || transaction === null) return [];
  const ledger = (transaction as Record<string, unknown>).ledger;
  if (!Array.isArray(ledger)) return [];
  return [
    ...new Set(
      ledger.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const removed = (entry as Record<string, unknown>).removedIds;
        return Array.isArray(removed)
          ? removed.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
      }),
    ),
  ];
}

export function generateStaticReport(input: StaticReportInput): string {
  const manifest = input.manifest;
  const transactionReduction =
    manifest.originalTransactionCount === 0
      ? 0
      : 1 - manifest.finalTransactionCount / manifest.originalTransactionCount;
  const fieldReduction =
    manifest.originalFieldCount === 0
      ? 0
      : 1 - manifest.finalFieldCount / manifest.originalFieldCount;
  const removed = removedTransactionIds(input.proof);
  const removedRows =
    removed.length === 0
      ? '<tr><td colspan="2">No removable transaction recorded</td></tr>'
      : removed
          .map(
            (id) =>
              `<tr><td><code>${escapeHtml(id)}</code></td><td>Removed after Oracle verification</td></tr>`,
          )
          .join("");
  const redactionRows =
    input.redaction.substitutions.length === 0
      ? '<tr><td colspan="3">No substitutions required</td></tr>'
      : input.redaction.substitutions
          .map(
            (entry) =>
              `<tr><td>${escapeHtml(entry.kind)}</td><td><code>${escapeHtml(entry.placeholder)}</code></td><td><code>${escapeHtml(entry.fingerprint)}</code></td></tr>`,
          )
          .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(manifest.name)} · ReproCore report</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}body{max-width:76rem;margin:0 auto;padding:2.5rem 1.25rem;background:#f6f7fb;color:#172033}header{display:flex;gap:1rem;align-items:center}.mark{width:2.5rem;height:2.5rem;color:#3157d5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem;margin:2rem 0}.card,section{background:#fff;border:1px solid #dce1ea;border-radius:.75rem;padding:1rem;box-shadow:0 2px 10px #1720330d}.value{font-size:1.7rem;font-weight:700;margin:.25rem 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #e4e7ee;padding:.65rem;vertical-align:top}code{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.status{font-weight:700;color:#3157d5}@media(prefers-color-scheme:dark){body{background:#111827;color:#e5e7eb}.card,section{background:#1f2937;border-color:#374151}th,td{border-color:#374151}}
  </style>
</head>
<body>
  <header><svg class="mark" viewBox="0 0 32 32" role="img" aria-label="ReproCore"><path fill="currentColor" d="M16 2 29 9v14l-13 7L3 23V9Zm0 4.3L7 11v9.6l9 4.9 9-4.9V11Zm-5 6.2h10v3H11Zm0 5h7v3h-7Z"/></svg><div><h1>${escapeHtml(manifest.name)}</h1><p class="status">${escapeHtml(manifest.caseType)} · ${escapeHtml(manifest.minimality)}</p></div></header>
  <div class="grid">
    <div class="card"><div>Transactions</div><div class="value">${manifest.originalTransactionCount} → ${manifest.finalTransactionCount}</div><div>${percentage(transactionReduction)} removed</div></div>
    <div class="card"><div>JSON fields</div><div class="value">${manifest.originalFieldCount} → ${manifest.finalFieldCount}</div><div>${percentage(fieldReduction)} removed</div></div>
    <div class="card"><div>Baseline</div><div class="value">${manifest.baseline.passed}/${manifest.baseline.repeat}</div><div>Original failure checks</div></div>
    <div class="card"><div>Export replay</div><div class="value">${manifest.finalVerification.passed}/${manifest.finalVerification.repeat}</div><div>Redacted package checks</div></div>
  </div>
  <section><h2>Reproduction</h2><p>Run <code>node --test runner/regression.test.mjs</code>. This report is fully offline and contains no active scripts.</p><p>Protocol: <code>${escapeHtml(manifest.protocolProfile.protocolVersion)}</code></p><p>Fixture: <code>${escapeHtml(manifest.fixtureHash)}</code></p><p>Oracle: <code>${escapeHtml(manifest.oracleHash)}</code></p></section>
  <section><h2>Removed transactions</h2><table><thead><tr><th>ID</th><th>Reason</th></tr></thead><tbody>${removedRows}</tbody></table></section>
  <section><h2>Redaction proof</h2><p>Two-pass scan: <strong>${input.redaction.verified ? "passed" : "blocked"}</strong>. Replay after redaction: <strong>${input.redaction.replayVerified ? "passed" : "not verified"}</strong>.</p><table><thead><tr><th>Kind</th><th>Placeholder</th><th>Fingerprint</th></tr></thead><tbody>${redactionRows}</tbody></table></section>
</body>
</html>
`;
}
