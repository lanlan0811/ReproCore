import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { captureProcess, SensitiveContentError } from "../src/index.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "reprocore-capture-"));
  temporaryDirectories.push(path);
  return path;
}

function collector(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("stdio capture", () => {
  it("forwards bytes unchanged and keeps stderr separate", async () => {
    const input = new PassThrough();
    const outputChunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    const outputDirectory = join(temporaryDirectory(), "session");
    const fixturePath = fileURLToPath(
      new URL("./fixtures/echo-server.mjs", import.meta.url),
    );
    const request = Buffer.from(
      '{"jsonrpc":"2.0","id":"CaseSensitive","method":"tools/list","params":{}}\r\n',
    );

    const capture = captureProcess({
      command: process.execPath,
      args: [fixturePath],
      outputDirectory,
      input,
      output: collector(outputChunks),
      errorOutput: collector(errorChunks),
    });
    input.end(request);
    const result = await capture;

    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(outputChunks)).toEqual(request);
    expect(Buffer.concat(errorChunks).toString("utf8")).toBe(
      "fixture diagnostic\n",
    );

    const rawRecords = readFileSync(
      join(outputDirectory, "raw-frames.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rawRecords.map((record) => record.channel).sort()).toEqual([
      "stderr",
      "stdin",
      "stdout",
    ]);
    expect(rawRecords.every((record) => !("contentBase64" in record))).toBe(
      true,
    );
  });

  it("blocks a credential before writing captured content", async () => {
    const input = new PassThrough();
    const outputDirectory = join(temporaryDirectory(), "sensitive-session");
    const fixturePath = fileURLToPath(
      new URL("./fixtures/echo-server.mjs", import.meta.url),
    );
    const capture = captureProcess({
      command: process.execPath,
      args: [fixturePath],
      outputDirectory,
      includeContent: true,
      input,
      output: collector([]),
      errorOutput: collector([]),
    });
    input.end(
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"api_key":"abcdefghijklmnop"}}\n',
    );

    await expect(capture).rejects.toBeInstanceOf(SensitiveContentError);
    expect(
      readFileSync(join(outputDirectory, "raw-frames.jsonl"), "utf8"),
    ).not.toContain("abcdefghijklmnop");
  });

  it("writes a replay fixture for complete content-enabled exchanges", async () => {
    const input = new PassThrough();
    const outputDirectory = join(temporaryDirectory(), "fixture-session");
    const fixturePath = fileURLToPath(
      new URL("./fixtures/reply-server.mjs", import.meta.url),
    );
    const capture = captureProcess({
      command: process.execPath,
      args: [fixturePath],
      outputDirectory,
      includeContent: true,
      input,
      output: collector([]),
      errorOutput: collector([]),
    });
    input.end(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: { protocolVersion: "2026-07-28", capabilities: {} },
      })}\n`,
    );

    await expect(capture).resolves.toEqual({ exitCode: 0, signal: null });
    const replay = JSON.parse(
      readFileSync(join(outputDirectory, "replay.fixture.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(replay.protocolVersion).toBe("2026-07-28");
    expect(replay.exchanges).toHaveLength(1);
    const summary = JSON.parse(
      readFileSync(join(outputDirectory, "capture.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(summary.replayFixture).toBe("replay.fixture.json");
  });
});
