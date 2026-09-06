import { resolve } from "node:path";
import type { Writable } from "node:stream";
import {
  captureProcess,
  SensitiveContentError,
} from "@reprocore/capture-stdio";
import { EXIT_CODES, VERSION } from "./index.js";

const HELP = `ReproCore ${VERSION}

Usage:
  reprocore capture --out <directory> [--include-content] [--json] -- <server> [args...]
  reprocore --version

Commands:
  capture  Transparently proxy and record an MCP stdio server

Options:
  -h, --help         Show this help
  -v, --version      Show the version
  --json             Emit the command summary as JSON on stderr
`;

export interface CliIo {
  stdout: Writable;
  stderr: Writable;
}

const defaultIo: CliIo = { stdout: process.stdout, stderr: process.stderr };

interface CaptureArguments {
  command: string;
  commandArguments: string[];
  includeContent: boolean;
  json: boolean;
  outputDirectory: string;
}

function parseCaptureArguments(args: string[]): CaptureArguments {
  const separator = args.indexOf("--");
  if (separator < 0 || separator === args.length - 1) {
    throw new Error("capture requires `-- <server> [args...]`");
  }
  const options = args.slice(0, separator);
  const server = args.slice(separator + 1);
  let outputDirectory: string | undefined;
  let includeContent = false;
  let json = false;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--include-content") includeContent = true;
    else if (option === "--json") json = true;
    else if (option === "--out") {
      outputDirectory = options[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown capture option: ${option ?? ""}`);
    }
  }
  if (outputDirectory === undefined)
    throw new Error("capture requires --out <directory>");
  const command = server[0];
  if (command === undefined)
    throw new Error("capture server command is missing");
  return {
    command,
    commandArguments: server.slice(1),
    includeContent,
    json,
    outputDirectory: resolve(outputDirectory),
  };
}

export async function runCli(
  args: string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout.write(HELP);
    return EXIT_CODES.success;
  }
  if (command === "--version" || command === "-v") {
    io.stdout.write(`${VERSION}\n`);
    return EXIT_CODES.success;
  }
  if (command !== "capture") {
    io.stderr.write(`Unknown command: ${command}\n`);
    return EXIT_CODES.usage;
  }

  try {
    const parsed = parseCaptureArguments(args.slice(1));
    const result = await captureProcess({
      command: parsed.command,
      args: parsed.commandArguments,
      outputDirectory: parsed.outputDirectory,
      includeContent: parsed.includeContent,
      output: io.stdout,
      errorOutput: io.stderr,
    });
    if (parsed.json) {
      io.stderr.write(
        `${JSON.stringify({ command: "capture", output: parsed.outputDirectory, ...result })}\n`,
      );
    }
    return result.exitCode;
  } catch (error) {
    const safetyBlocked = error instanceof SensitiveContentError;
    io.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        safetyBlocked,
      })}\n`,
    );
    return safetyBlocked ? EXIT_CODES.safetyBlocked : EXIT_CODES.usage;
  }
}
