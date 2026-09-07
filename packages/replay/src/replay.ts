import { isDeepStrictEqual } from "node:util";
import { sha256 } from "@reprocore/format";
import {
  evaluateOracle,
  OracleDocumentSchema,
  type OracleDocument,
  type OracleEvaluation,
  type OracleObservation,
} from "@reprocore/oracles";
import type { JsonRpcMessage, ReplayFixture } from "./fixture.js";
import {
  runDockerReplay,
  type DockerExecutor,
  type DockerReplayOptions,
  type DockerReplayResult,
} from "./docker-backend.js";

export class ReplayMismatchError extends Error {
  public constructor(index: number) {
    super(`Replay request does not match fixture exchange ${index}`);
    this.name = "ReplayMismatchError";
  }
}

function comparableRequest(request: JsonRpcMessage): unknown {
  const comparable = { ...request };
  delete comparable.id;
  return comparable;
}

export class FixedResponseReplayBackend {
  readonly #fixture: ReplayFixture;
  #index = 0;

  public constructor(fixture: ReplayFixture) {
    this.#fixture = fixture;
  }

  public respond(request: JsonRpcMessage): JsonRpcMessage {
    const exchange = this.#fixture.exchanges[this.#index];
    if (
      exchange === undefined ||
      !isDeepStrictEqual(
        comparableRequest(request),
        comparableRequest(exchange.request),
      )
    ) {
      throw new ReplayMismatchError(this.#index);
    }
    this.#index += 1;
    return { ...structuredClone(exchange.response), id: request.id };
  }

  public get complete(): boolean {
    return this.#index === this.#fixture.exchanges.length;
  }
}

export interface ReplayRun {
  observation: OracleObservation;
  responses: JsonRpcMessage[];
}

export function runFixtureReplay(fixture: ReplayFixture): ReplayRun {
  const backend = new FixedResponseReplayBackend(fixture);
  const responses = fixture.exchanges.map((exchange) =>
    backend.respond(exchange.request),
  );
  const toolCalls = fixture.exchanges.flatMap(({ request }) => {
    if (request.method !== "tools/call") return [];
    const params = request.params;
    if (typeof params !== "object" || params === null) return [];
    const name = (params as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
  const fileHashes = Object.fromEntries(
    Object.entries(fixture.files).map(([path, content]) => [
      path,
      sha256(content),
    ]),
  );
  const observation: OracleObservation = {
    messages: responses,
    requestMessages: fixture.exchanges.map((exchange) => exchange.request),
    toolCalls,
    fileHashes,
    effects: fixture.observation.effects ?? [],
  };
  if (fixture.observation.exitCode !== undefined) {
    observation.exitCode = fixture.observation.exitCode;
  }
  if (fixture.observation.timedOut !== undefined) {
    observation.timedOut = fixture.observation.timedOut;
  }
  if (fixture.observation.durationMs !== undefined) {
    observation.durationMs = fixture.observation.durationMs;
  }
  return { observation, responses };
}

export interface BaselineResult {
  status: "STABLE" | "FLAKY_UNSUPPORTED";
  evaluations: OracleEvaluation[];
}

export type DockerOracleOptions = Omit<
  DockerReplayOptions,
  "command" | "containerName" | "stdin"
>;

export interface DockerOracleEvaluation {
  docker: DockerReplayResult;
  evaluation: OracleEvaluation;
}

export class MissingCustomScriptError extends Error {
  public constructor() {
    super("Docker Oracle evaluation requires one custom_script rule");
    this.name = "MissingCustomScriptError";
  }
}

function baselineResult(evaluations: OracleEvaluation[]): BaselineResult {
  return {
    status: evaluations.every(
      (evaluation) => evaluation.result === "INTERESTING",
    )
      ? "STABLE"
      : "FLAKY_UNSUPPORTED",
    evaluations,
  };
}

export async function evaluateFixtureWithDocker(
  fixture: ReplayFixture,
  oracle: OracleDocument,
  options: DockerOracleOptions,
  execute?: DockerExecutor,
): Promise<DockerOracleEvaluation> {
  const parsedOracle = OracleDocumentSchema.parse(oracle);
  const script = parsedOracle.rules.find(
    (rule) => rule.kind === "custom_script",
  );
  if (script === undefined) throw new MissingCustomScriptError();
  const docker = await runDockerReplay(
    {
      ...options,
      command: [script.command, ...script.args],
      stdin: `${JSON.stringify(fixture)}\n`,
    },
    execute,
  );
  const fixedObservation = runFixtureReplay(fixture).observation;
  return {
    docker,
    evaluation: evaluateOracle(parsedOracle, {
      ...fixedObservation,
      ...(docker.observation.customScriptExitCode === undefined
        ? {}
        : {
            customScriptExitCode: docker.observation.customScriptExitCode,
          }),
    }),
  };
}

export async function verifyDockerBaseline(
  fixture: ReplayFixture,
  oracle: OracleDocument,
  options: DockerOracleOptions,
  repeat = 3,
  execute?: DockerExecutor,
): Promise<BaselineResult> {
  const evaluations: OracleEvaluation[] = [];
  for (let index = 0; index < repeat; index += 1) {
    evaluations.push(
      (await evaluateFixtureWithDocker(fixture, oracle, options, execute))
        .evaluation,
    );
  }
  return baselineResult(evaluations);
}

export function verifyBaseline(
  fixture: ReplayFixture,
  oracle: OracleDocument,
  repeat = 3,
): BaselineResult {
  const evaluations = Array.from({ length: repeat }, () =>
    evaluateOracle(oracle, runFixtureReplay(fixture).observation),
  );
  return baselineResult(evaluations);
}
