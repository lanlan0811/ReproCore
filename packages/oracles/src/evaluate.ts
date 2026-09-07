import { isDeepStrictEqual } from "node:util";
import { compileJsonSchema, type CandidateResult } from "@reprocore/format";
import type { OracleDocument, OracleRule } from "./document.js";

export interface OracleObservation {
  exitCode?: number;
  timedOut?: boolean;
  durationMs?: number;
  messages?: unknown[];
  requestMessages?: unknown[];
  toolCalls?: string[];
  fileHashes?: Record<string, string>;
  effects?: string[];
  customScriptExitCode?: number;
}

export interface RuleEvaluation {
  kind: OracleRule["kind"];
  result: CandidateResult;
  reason: string;
}

export interface OracleEvaluation {
  result: CandidateResult;
  rules: RuleEvaluation[];
}

function result(
  condition: boolean,
  kind: OracleRule["kind"],
  reason: string,
): RuleEvaluation {
  return {
    kind,
    result: condition ? "INTERESTING" : "NOT_INTERESTING",
    reason,
  };
}

function unresolved(kind: OracleRule["kind"], reason: string): RuleEvaluation {
  return { kind, result: "UNRESOLVED", reason };
}

function jsonPointer(
  value: unknown,
  pointer: string,
): { found: boolean; value?: unknown } {
  let current = value;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      typeof current !== "object" ||
      current === null ||
      !(token in current)
    ) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[token];
  }
  return { found: true, value: current };
}

function evaluateRule(
  rule: OracleRule,
  observation: OracleObservation,
): RuleEvaluation {
  switch (rule.kind) {
    case "process_exit": {
      if (observation.exitCode === undefined)
        return unresolved(rule.kind, "exit code unavailable");
      const matches = observation.exitCode === rule.value;
      return result(
        rule.operator === "equals" ? matches : !matches,
        rule.kind,
        `exit code ${observation.exitCode}`,
      );
    }
    case "timeout": {
      if (observation.timedOut === undefined)
        return unresolved(rule.kind, "timeout state unavailable");
      return result(
        observation.timedOut && (observation.durationMs ?? 0) >= rule.timeoutMs,
        rule.kind,
        observation.timedOut ? "execution timed out" : "execution completed",
      );
    }
    case "json_schema_invalid": {
      const message =
        rule.target === "last_request"
          ? observation.requestMessages?.at(-1)
          : observation.messages?.at(-1);
      if (message === undefined)
        return unresolved(rule.kind, "response message unavailable");
      const validate = compileJsonSchema(rule.schema);
      return result(
        !validate(message),
        rule.kind,
        validate.errors?.[0]?.message ?? "schema valid",
      );
    }
    case "json_pointer": {
      const message =
        rule.target === "last_request"
          ? observation.requestMessages?.at(-1)
          : observation.messages?.at(-1);
      if (message === undefined)
        return unresolved(rule.kind, "response message unavailable");
      const pointer = jsonPointer(message, rule.pointer);
      const condition =
        rule.operator === "exists"
          ? pointer.found
          : rule.operator === "missing"
            ? !pointer.found
            : pointer.found &&
              (rule.operator === "equals"
                ? isDeepStrictEqual(pointer.value, rule.value)
                : !isDeepStrictEqual(pointer.value, rule.value));
      return result(condition, rule.kind, `JSON pointer ${rule.pointer}`);
    }
    case "tool_called":
      if (observation.toolCalls === undefined)
        return unresolved(rule.kind, "tool calls unavailable");
      return result(
        observation.toolCalls.includes(rule.tool),
        rule.kind,
        `required tool ${rule.tool}`,
      );
    case "forbidden_tool":
      if (observation.toolCalls === undefined)
        return unresolved(rule.kind, "tool calls unavailable");
      return result(
        observation.toolCalls.includes(rule.tool),
        rule.kind,
        `forbidden tool ${rule.tool}`,
      );
    case "file_hash": {
      const actual = observation.fileHashes?.[rule.path];
      if (actual === undefined)
        return unresolved(rule.kind, `file hash unavailable: ${rule.path}`);
      const matches = actual === rule.expected;
      return result(
        rule.operator === "equals" ? matches : !matches,
        rule.kind,
        `file hash ${actual}`,
      );
    }
    case "forbidden_effect":
      if (observation.effects === undefined)
        return unresolved(rule.kind, "effects unavailable");
      return result(
        observation.effects.includes(rule.effect),
        rule.kind,
        `forbidden effect ${rule.effect}`,
      );
    case "custom_script":
      if (observation.customScriptExitCode === undefined) {
        return unresolved(
          rule.kind,
          "custom script was not run by an isolated backend",
        );
      }
      return result(
        observation.customScriptExitCode === 0,
        rule.kind,
        `custom script exit code ${observation.customScriptExitCode}`,
      );
  }
}

export function evaluateOracle(
  document: OracleDocument,
  observation: OracleObservation,
): OracleEvaluation {
  const rules = document.rules.map((rule) => evaluateRule(rule, observation));
  let combined: CandidateResult;
  if (document.mode === "all") {
    combined = rules.some((entry) => entry.result === "NOT_INTERESTING")
      ? "NOT_INTERESTING"
      : rules.some((entry) => entry.result === "UNRESOLVED")
        ? "UNRESOLVED"
        : "INTERESTING";
  } else {
    combined = rules.some((entry) => entry.result === "INTERESTING")
      ? "INTERESTING"
      : rules.some((entry) => entry.result === "UNRESOLVED")
        ? "UNRESOLVED"
        : "NOT_INTERESTING";
  }
  return { result: combined, rules };
}
