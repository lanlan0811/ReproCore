import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@reprocore/format";
import type { OracleObservation } from "@reprocore/oracles";
import {
  GeneratedFixturePlanSchema,
  safeWorkspacePath,
  type GeneratedFixturePlan,
} from "./plan.js";
import { runChildProcess, sanitizeEnvironment } from "./process.js";

const DEFAULT_ENVIRONMENT_ALLOWLIST = [
  "ComSpec",
  "LANG",
  "LC_ALL",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
] as const;

export interface LocalReplayOptions {
  timeoutMs: number;
  environmentAllowlist?: string[];
}

export interface LocalReplayResult {
  backendVersion: "1";
  backend: "local-generated-fixture";
  observation: OracleObservation;
  stderrHash: string;
  stdoutHash: string;
}

function writeFixtureFiles(root: string, files: Record<string, string>): void {
  for (const [portablePath, content] of Object.entries(files)) {
    const target = safeWorkspacePath(root, portablePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
  }
}

function collectFileHashes(
  root: string,
  directory = root,
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory())
      Object.assign(hashes, collectFileHashes(root, absolute));
    else if (entry.isFile() && entry.name !== ".reprocore-plan.json") {
      const portable = relative(root, absolute).split(sep).join("/");
      hashes[portable] = sha256(readFileSync(absolute));
    }
  }
  return hashes;
}

function removeWorkspace(workspace: string, temporaryRoot: string): void {
  const resolvedWorkspace = resolve(workspace);
  const resolvedRoot = resolve(temporaryRoot);
  if (
    !resolvedWorkspace.startsWith(`${resolvedRoot}${sep}`) ||
    !statSync(resolvedWorkspace).isDirectory()
  ) {
    throw new Error(
      `Refusing to clean an unexpected replay workspace: ${workspace}`,
    );
  }
  rmSync(resolvedWorkspace, { recursive: true, force: true });
}

export async function runLocalGeneratedFixture(
  input: GeneratedFixturePlan,
  options: LocalReplayOptions,
): Promise<LocalReplayResult> {
  const plan = GeneratedFixturePlanSchema.parse(input);
  const temporaryRoot = tmpdir();
  const workspace = mkdtempSync(join(temporaryRoot, "reprocore-replay-"));
  try {
    writeFixtureFiles(workspace, plan.files);
    const planPath = safeWorkspacePath(workspace, ".reprocore-plan.json");
    writeFileSync(planPath, JSON.stringify(plan), {
      encoding: "utf8",
      flag: "wx",
    });
    const adjacentRunnerPath = fileURLToPath(
      new URL("./fixture-runner.js", import.meta.url),
    );
    const runnerPath = existsSync(adjacentRunnerPath)
      ? adjacentRunnerPath
      : resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../dist/fixture-runner.js",
        );
    const execution = await runChildProcess(
      process.execPath,
      [runnerPath, planPath],
      {
        cwd: workspace,
        env: sanitizeEnvironment(
          process.env,
          options.environmentAllowlist ?? DEFAULT_ENVIRONMENT_ALLOWLIST,
        ),
        timeoutMs: options.timeoutMs,
      },
    );
    const effects = plan.actions.flatMap((action) =>
      action.kind === "write_file" ? [`file_written:${action.path}`] : [],
    );
    return {
      backendVersion: "1",
      backend: "local-generated-fixture",
      observation: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        durationMs: execution.durationMs,
        fileHashes: collectFileHashes(workspace),
        effects,
      },
      stdoutHash: sha256(execution.stdout),
      stderrHash: sha256(execution.stderr),
    };
  } finally {
    removeWorkspace(workspace, temporaryRoot);
  }
}
