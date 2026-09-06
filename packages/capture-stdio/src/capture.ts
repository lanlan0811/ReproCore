import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";
import type { Readable, Writable } from "node:stream";
import { CaptureWriter } from "./writer.js";
import { FrameTap } from "./frame-tap.js";

const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export interface CaptureProcessOptions {
  command: string;
  args?: string[];
  outputDirectory: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  includeContent?: boolean;
  maxFrameBytes?: number;
  input?: Readable;
  output?: Writable;
  errorOutput?: Writable;
}

export interface CaptureResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export async function captureProcess(
  options: CaptureProcessOptions,
): Promise<CaptureResult> {
  const writer = new CaptureWriter({
    outputDirectory: options.outputDirectory,
    includeContent: options.includeContent === true,
  });
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const inputTap = new FrameTap({
    maxFrameBytes,
    onFrame: (frame) => writer.recordFrame(frame, "stdin", "client_to_server"),
  });
  const outputTap = new FrameTap({
    maxFrameBytes,
    onFrame: (frame) => writer.recordFrame(frame, "stdout", "server_to_client"),
  });
  const errorTap = new FrameTap({
    maxFrameBytes,
    onFrame: (frame) => writer.recordFrame(frame, "stderr"),
  });

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  input.pipe(inputTap).pipe(child.stdin);
  child.stdout.pipe(outputTap).pipe(output, { end: false });
  child.stderr.pipe(errorTap).pipe(errorOutput, { end: false });

  const streamError = new Promise<never>((_resolve, reject) => {
    for (const stream of [inputTap, outputTap, errorTap]) {
      stream.once("error", (error) => {
        child.kill();
        reject(error);
      });
    }
  });
  const completion = new Promise<CaptureResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal });
    });
  });

  try {
    const result = await Promise.race([completion, streamError]);
    await Promise.all([finished(outputTap), finished(errorTap)]);
    writer.close(result.exitCode, result.signal);
    return result;
  } catch (error) {
    writer.close(1, null);
    throw error;
  }
}
