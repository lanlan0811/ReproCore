import { spawn } from "node:child_process";

const DEFAULT_OUTPUT_LIMIT = 1024 * 1024;

export interface ChildExecutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Uint8Array;
  timeoutMs: number;
  outputLimitBytes?: number;
}

export interface ChildExecutionResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  durationMs: number;
  stdout: Buffer;
  stderr: Buffer;
}

export function sanitizeEnvironment(
  source: NodeJS.ProcessEnv,
  allowedNames: readonly string[],
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    allowedNames.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function killProcessTree(processId: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(processId), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
  } else {
    try {
      process.kill(-processId, "SIGKILL");
    } catch {
      // The process may have exited between the timer and the kill request.
    }
  }
}

export async function runChildProcess(
  command: string,
  args: string[],
  options: ChildExecutionOptions,
): Promise<ChildExecutionResult> {
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== "win32",
    shell: false,
    windowsHide: true,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (child.stdin !== null) {
    child.stdin.on("error", () => {
      // The child may intentionally exit before consuming the whole input.
    });
    child.stdin.end(options.input);
  }
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const outputLimit = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
  let outputBytes = 0;
  let timedOut = false;
  let outputLimitExceeded = false;

  const collect = (target: Buffer[], chunk: Buffer): void => {
    outputBytes += chunk.length;
    if (outputBytes > outputLimit) {
      if (!outputLimitExceeded && child.pid !== undefined) {
        outputLimitExceeded = true;
        killProcessTree(child.pid);
      }
      return;
    }
    target.push(Buffer.from(chunk));
  };
  child.stdout!.on("data", (chunk: Buffer) => collect(stdout, chunk));
  child.stderr!.on("data", (chunk: Buffer) => collect(stderr, chunk));

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) killProcessTree(child.pid);
  }, options.timeoutMs);

  try {
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolvePromise({ code, signal }));
    });
    return {
      exitCode: result.code ?? 1,
      signal: result.signal,
      timedOut,
      outputLimitExceeded,
      durationMs: Date.now() - startedAt,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    };
  } finally {
    clearTimeout(timer);
  }
}
