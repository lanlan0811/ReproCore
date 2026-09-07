import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/{capture-stdio,format,minimizer,oracles,protocol-mcp,redaction,replay,report}/src/**/*.ts",
      ],
      thresholds: { lines: 80 },
    },
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
  },
});
