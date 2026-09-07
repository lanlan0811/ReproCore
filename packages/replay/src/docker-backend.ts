import { randomUUID } from "node:crypto";
import { sha256 } from "@reprocore/format";
import type { OracleObservation } from "@reprocore/oracles";
import { runChildProcess, type ChildExecutionResult } from "./process.js";

export interface DockerReplayOptions {
  image: string;
  command: string[];
  containerName?: string;
  timeoutMs: number;
  dockerBinary?: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidLimit?: number;
  stdin?: string;
}

export interface DockerReplayResult {
  backendVersion: "1";
  backend: "docker";
  observation: OracleObservation;
  outputLimitExceeded: boolean;
  invocationHash: string;
  stderrHash: string;
  stdoutHash: string;
}

export type DockerExecutor = (
  command: string,
  args: string[],
  options: { input?: string; timeoutMs: number },
) => Promise<ChildExecutionResult>;

export class UnsafeDockerImageError extends Error {
  public constructor(image: string) {
    super(`Docker image must be pinned by SHA-256 digest: ${image}`);
    this.name = "UnsafeDockerImageError";
  }
}

export class DockerCleanupError extends Error {
  public constructor(containerName: string) {
    super(`Failed to remove interrupted Docker container: ${containerName}`);
    this.name = "DockerCleanupError";
  }
}

function assertContainerName(name: string): void {
  if (!/^reprocore-[a-z0-9][a-z0-9-]{0,62}$/u.test(name)) {
    throw new Error(`Unsafe Docker container name: ${name}`);
  }
}

export function createDockerArguments(options: DockerReplayOptions): string[] {
  if (!/@sha256:[a-f0-9]{64}$/u.test(options.image)) {
    throw new UnsafeDockerImageError(options.image);
  }
  if (options.containerName !== undefined) {
    assertContainerName(options.containerName);
  }
  const args = [
    "run",
    "--rm",
    "--network=none",
    "--user=65532:65532",
    "--read-only",
    `--cpus=${options.cpuLimit ?? 1}`,
    `--memory=${options.memoryLimit ?? "512m"}`,
    `--pids-limit=${options.pidLimit ?? 64}`,
    "--tmpfs=/tmp:rw,noexec,nosuid,size=64m",
  ];
  if (options.containerName !== undefined) {
    args.push("--name", options.containerName);
  }
  if (options.stdin !== undefined) args.push("--interactive");
  args.push(options.image, ...options.command);
  return args;
}

export async function runDockerReplay(
  options: DockerReplayOptions,
  execute: DockerExecutor = runChildProcess,
): Promise<DockerReplayResult> {
  const dockerBinary =
    options.dockerBinary ?? process.env.REPROCORE_DOCKER_BIN ?? "docker";
  const containerName = options.containerName ?? `reprocore-${randomUUID()}`;
  const args = createDockerArguments({ ...options, containerName });
  const execution = await execute(dockerBinary, args, {
    ...(options.stdin === undefined ? {} : { input: options.stdin }),
    timeoutMs: options.timeoutMs,
  });
  if (execution.timedOut || execution.outputLimitExceeded) {
    const cleanup = await execute(
      dockerBinary,
      ["rm", "--force", containerName],
      { timeoutMs: 10_000 },
    );
    if (cleanup.exitCode !== 0) throw new DockerCleanupError(containerName);
  }
  const observation: OracleObservation = {
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    durationMs: execution.durationMs,
  };
  if (!execution.timedOut && !execution.outputLimitExceeded) {
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
        containerName,
        stdinHash:
          options.stdin === undefined ? undefined : sha256(options.stdin),
        timeoutMs: options.timeoutMs,
      }),
    ),
    observation,
    outputLimitExceeded: execution.outputLimitExceeded,
    stdoutHash: sha256(execution.stdout),
    stderrHash: sha256(execution.stderr),
  };
}
