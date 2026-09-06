import { describe, expect, it } from "vitest";
import { sha256 } from "@reprocore/format";
import {
  createOracleTemplate,
  evaluateOracle,
  OracleDocumentSchema,
  type OracleDocument,
} from "../src/index.js";

function oracle(rules: OracleDocument["rules"]): OracleDocument {
  return { ...createOracleTemplate("test"), rules };
}

describe("oracle evaluation", () => {
  it("evaluates all six deterministic oracle categories", () => {
    const document = oracle([
      { kind: "process_exit", operator: "not_equals", value: 0 },
      { kind: "timeout", timeoutMs: 100 },
      {
        kind: "json_schema_invalid",
        schema: {
          type: "object",
          properties: { expected: { type: "boolean" } },
          required: ["expected"],
        },
      },
      { kind: "tool_called", tool: "write_file" },
      {
        kind: "file_hash",
        path: "fixtures/report.md",
        operator: "not_equals",
        expected: sha256("expected"),
      },
      { kind: "custom_script", command: "oracle-check" },
    ]);

    const evaluation = evaluateOracle(document, {
      exitCode: 1,
      timedOut: true,
      durationMs: 100,
      messages: [{ actual: true }],
      toolCalls: ["write_file"],
      fileHashes: { "fixtures/report.md": sha256("wrong") },
      customScriptExitCode: 0,
    });

    expect(evaluation.result).toBe("INTERESTING");
    expect(evaluation.rules).toHaveLength(6);
  });

  it("detects forbidden tools and side effects", () => {
    const evaluation = evaluateOracle(
      oracle([
        { kind: "forbidden_tool", tool: "send_email" },
        { kind: "forbidden_effect", effect: "source_workspace_modified" },
      ]),
      { toolCalls: ["send_email"], effects: ["source_workspace_modified"] },
    );
    expect(evaluation.result).toBe("INTERESTING");
  });

  it("returns unresolved when evidence is unavailable", () => {
    expect(
      evaluateOracle(
        oracle([
          {
            kind: "file_hash",
            path: "missing",
            operator: "equals",
            expected: sha256(""),
          },
        ]),
        {},
      ).result,
    ).toBe("UNRESOLVED");
  });

  it("supports JSON Pointer comparisons", () => {
    expect(
      evaluateOracle(
        oracle([
          {
            kind: "json_pointer",
            pointer: "/result/path",
            operator: "equals",
            value: "wrong.md",
          },
        ]),
        { messages: [{ result: { path: "wrong.md" } }] },
      ).result,
    ).toBe("INTERESTING");
  });

  it("rejects unknown document versions and unsafe paths", () => {
    expect(() =>
      OracleDocumentSchema.parse({
        ...createOracleTemplate("bad"),
        version: 2,
      }),
    ).toThrow();
    expect(() =>
      OracleDocumentSchema.parse(
        oracle([
          {
            kind: "file_hash",
            path: "../outside",
            operator: "equals",
            expected: sha256(""),
          },
        ]),
      ),
    ).toThrow();
  });
});
