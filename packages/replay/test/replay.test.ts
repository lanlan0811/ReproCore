import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256 } from "@reprocore/format";
import { createOracleTemplate, type OracleDocument } from "@reprocore/oracles";
import {
  FixedResponseReplayBackend,
  readReplayFixture,
  ReplayMismatchError,
  runFixtureReplay,
  verifyBaseline,
} from "../src/index.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/wrong-file.json", import.meta.url),
);

function failureOracle(): OracleDocument {
  return {
    ...createOracleTemplate("wrong-target-file"),
    rules: [
      { kind: "tool_called", tool: "write_file" },
      {
        kind: "file_hash",
        path: "fixtures/report.md",
        operator: "not_equals",
        expected: sha256("expected content"),
      },
      { kind: "forbidden_effect", effect: "wrong_target_written" },
    ],
  };
}

describe("fixed response replay", () => {
  it("replays responses deterministically and preserves incoming IDs", () => {
    const fixture = readReplayFixture(fixturePath);
    const backend = new FixedResponseReplayBackend(fixture);
    const request = { ...fixture.exchanges[0]!.request, id: "new-id" };
    const response = backend.respond(request);

    expect(response.id).toBe("new-id");
    expect(response.result).toEqual(fixture.exchanges[0]!.response.result);
  });

  it("refuses requests that do not match the next fixture", () => {
    const fixture = readReplayFixture(fixturePath);
    const backend = new FixedResponseReplayBackend(fixture);
    expect(() =>
      backend.respond({ jsonrpc: "2.0", id: 1, method: "other" }),
    ).toThrow(ReplayMismatchError);
  });

  it("passes a 3/3 file-state and forbidden-effect baseline", () => {
    const fixture = readReplayFixture(fixturePath);
    const replay = runFixtureReplay(fixture);
    expect(replay.responses).toHaveLength(2);
    expect(verifyBaseline(fixture, failureOracle()).status).toBe("STABLE");
  });
});
