import { sha256 } from "@reprocore/format";
import type { OracleObservation } from "@reprocore/oracles";
import { runChildProcess, type ChildExecutionResult } from "./process.js";

export interface DockerReplayOptions {
  image: string;
  command: string[];
  timeoutMs: number;
  dockerBinary?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidLimit?: number;
}

export interface DockerReplayResult {
  backendVersion: "1";
  backend: "docker";
  observation: OracleObservation;
  invocationHash: string;
  stderrHash: string;
  stdoutHash: string;
}

export type DockerExecutor = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<ChildExecutionResult>;

export class UnsafeDockerImageError extends Error {
  public constructor(image: string) {
    super(`Docker image must be pinned by SHA-256 digest: ${image}`);
    this.name = "UnsafeDockerImageError";
  }
}

export function createDockerArguments(options: DockerReplayOptions): string[] {
  if (!/@sha256:[a-f0-9]{64}$/u.test(options.image)) {
    throw new UnsafeDockerImageError(options.image);
  }
  return [
    "run",
    "--rm",
    "--network=none",
    "--user=65532:65532",
    "--read-only",
    `--cpus=${options.cpuLimit ?? 1}`,
    `--memory=${options.memoryLimit ?? "512m"}`,
    `--pids-limit=${options.pidLimit ?? 64}`,
    "--tmpfs=/tmp:rw,noexec,nosuid,size=64m",
    options.image,
    ...options.command,
  ];
}

export async function runDockerReplay(
  options: DockerReplayOptions,
  execute: DockerExecutor = runChildProcess,
): Promise<DockerReplayResult> {
  const dockerBinary =
    options.dockerBinary ?? process.env.REPROCORE_DOCKER_BIN ?? "docker";
  const args = createDockerArguments(options);
  const execution = await execute(dockerBinary, args, {
    timeoutMs: options.timeoutMs,
  });
  const observation: OracleObservation = {
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    durationMs: execution.durationMs,
  };
  if (!execution.timedOut) {
    observation.customScriptExitCode = execution.exitCode;
  }
  return {
    backendVersion: "1",
    backend: "docker",
    invocationHash: sha256(
      JSON.stringify({
        binary: dockerBinary,
        image: options.image,
        command: options.command,
        args,
        timeoutMs: options.timeoutMs,
      }),
    ),
    observation,
    stdoutHash: sha256(execution.stdout),
    stderrHash: sha256(execution.stderr),
  };
}
