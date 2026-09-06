import type { OracleObservation } from "@reprocore/oracles";
import { runChildProcess } from "./process.js";

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
}

export function createDockerArguments(options: DockerReplayOptions): string[] {
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
): Promise<DockerReplayResult> {
  const dockerBinary =
    options.dockerBinary ?? process.env.REPROCORE_DOCKER_BIN ?? "docker";
  const args = createDockerArguments(options);
  const execution = await runChildProcess(dockerBinary, args, {
    timeoutMs: options.timeoutMs,
  });
  return {
    backendVersion: "1",
    backend: "docker",
    observation: {
      exitCode: execution.exitCode,
      timedOut: execution.timedOut,
      durationMs: execution.durationMs,
    },
  };
}
