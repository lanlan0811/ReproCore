import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const threshold = 80;
const packageNames = [
  "capture-stdio",
  "format",
  "minimizer",
  "oracles",
  "protocol-mcp",
  "redaction",
  "replay",
  "report",
];
const summary = JSON.parse(
  readFileSync(resolve("coverage", "coverage-summary.json"), "utf8"),
);
const failures = [];

for (const packageName of packageNames) {
  const marker = `/packages/${packageName}/src/`;
  const files = Object.entries(summary).filter(([path]) =>
    path.replaceAll("\\", "/").includes(marker),
  );
  const totals = files.reduce(
    (result, [, coverage]) => ({
      total: result.total + coverage.lines.total,
      covered: result.covered + coverage.lines.covered,
    }),
    { total: 0, covered: 0 },
  );
  const percentage =
    totals.total === 0 ? 0 : (totals.covered / totals.total) * 100;
  process.stdout.write(
    `${packageName}: ${percentage.toFixed(2)}% line coverage\n`,
  );
  if (percentage < threshold) failures.push(packageName);
}

if (failures.length > 0) {
  throw new Error(
    `Core package line coverage is below ${threshold}%: ${failures.join(", ")}`,
  );
}
