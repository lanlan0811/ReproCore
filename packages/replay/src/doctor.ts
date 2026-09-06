import { platform, arch } from "node:os";
import { runChildProcess } from "./process.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface DoctorReport {
  ready: boolean;
  checks: DoctorCheck[];
}

function nodeSupported(version: string): boolean {
  const [majorText, minorText] = version.replace(/^v/u, "").split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  return major > 22 || (major === 22 && minor >= 13);
}

export async function runDoctor(
  dockerBinary = process.env.REPROCORE_DOCKER_BIN ?? "docker",
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    {
      name: "node",
      status: nodeSupported(process.version) ? "ok" : "error",
      detail: `${process.version} (${platform()} ${arch()})`,
    },
    {
      name: "local-fixture-backend",
      status: "ok",
      detail:
        "generated fixture actions only; temporary workspace and environment allowlist enabled",
    },
  ];
  try {
    const docker = await runChildProcess(
      dockerBinary,
      ["version", "--format", "{{.Server.Version}}"],
      { timeoutMs: 5_000 },
    );
    checks.push({
      name: "docker-backend",
      status: docker.exitCode === 0 ? "ok" : "warning",
      detail:
        docker.exitCode === 0
          ? `Docker server ${docker.stdout.toString("utf8").trim()}`
          : "Docker is unavailable; real servers and custom Oracle scripts are blocked",
    });
  } catch {
    checks.push({
      name: "docker-backend",
      status: "warning",
      detail:
        "Docker is unavailable; real servers and custom Oracle scripts are blocked",
    });
  }
  return { ready: checks.every((check) => check.status !== "error"), checks };
}
