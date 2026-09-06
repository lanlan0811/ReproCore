import {
  closeSync,
  mkdirSync,
  openSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  type Direction,
  type MinCaseEvent,
  type RawFrameRecord,
  parseJsonObject,
  scanSecretCandidates,
  sha256,
  summarizeValue,
} from "@reprocore/format";
import {
  createNormalizationState,
  normalizeMcpFrame,
  type NormalizationState,
} from "@reprocore/protocol-mcp";

export class SensitiveContentError extends Error {
  public readonly kinds: string[];

  public constructor(kinds: string[]) {
    super(
      `Capture blocked before write: sensitive content detected (${kinds.join(", ")})`,
    );
    this.name = "SensitiveContentError";
    this.kinds = kinds;
  }
}

export interface CaptureWriterOptions {
  outputDirectory: string;
  includeContent?: boolean;
}

export class CaptureWriter {
  readonly #includeContent: boolean;
  readonly #rawDescriptor: number;
  readonly #eventDescriptor: number;
  readonly #state: NormalizationState = createNormalizationState();
  readonly #outputDirectory: string;
  #closed = false;
  #sequence = 0;
  #frameCount = 0;
  #eventCount = 0;

  public constructor(options: CaptureWriterOptions) {
    this.#includeContent = options.includeContent === true;
    this.#outputDirectory = options.outputDirectory;
    mkdirSync(this.#outputDirectory, { recursive: true });
    this.#rawDescriptor = openSync(
      join(this.#outputDirectory, "raw-frames.jsonl"),
      "wx",
    );
    this.#eventDescriptor = openSync(
      join(this.#outputDirectory, "trace.jsonl"),
      "wx",
    );
  }

  public recordFrame(
    frame: Buffer,
    channel: "stdin" | "stdout" | "stderr",
    direction?: Direction,
  ): void {
    if (this.#closed) throw new Error("Capture writer is already closed");
    const text = frame.toString("utf8");
    if (this.#includeContent) {
      const findings = scanSecretCandidates(text);
      if (findings.length > 0) {
        throw new SensitiveContentError([
          ...new Set(findings.map((finding) => finding.kind)),
        ]);
      }
    }

    const timestamp = new Date().toISOString();
    const rawRecord: RawFrameRecord = {
      sequence: this.#sequence,
      timestamp,
      channel,
      byteLength: frame.length,
      contentHash: sha256(frame),
      summary: summarizeValue(parseJsonObject(text) ?? text),
    };
    if (direction !== undefined) rawRecord.direction = direction;
    if (this.#includeContent)
      rawRecord.contentBase64 = frame.toString("base64");
    this.#writeLine(this.#rawDescriptor, rawRecord);
    this.#frameCount += 1;

    if (direction !== undefined) {
      const normalized = normalizeMcpFrame(
        frame,
        direction,
        this.#sequence,
        this.#state,
        {
          includeContent: this.#includeContent,
          timestamp,
        },
      );
      if (normalized !== undefined) {
        this.#writeLine(this.#eventDescriptor, normalized.event);
        this.#eventCount += 1;
      }
    } else {
      const processEvent: MinCaseEvent = {
        eventId: `process-${this.#sequence}-${rawRecord.contentHash.slice(7, 19)}`,
        timestamp,
        channel: "process",
        kind: "stderr",
        parentIds: [],
        payloadRef: rawRecord.contentHash,
        sensitivity: this.#includeContent ? "content" : "metadata",
        replayMode: "blocked",
        payload: this.#includeContent ? text : summarizeValue(text),
      };
      this.#writeLine(this.#eventDescriptor, processEvent);
      this.#eventCount += 1;
    }
    this.#sequence += 1;
  }

  public close(exitCode: number, signal: NodeJS.Signals | null): void {
    if (this.#closed) return;
    closeSync(this.#rawDescriptor);
    closeSync(this.#eventDescriptor);
    this.#closed = true;
    writeFileSync(
      join(this.#outputDirectory, "capture.json"),
      `${JSON.stringify(
        {
          version: 1,
          includeContent: this.#includeContent,
          protocolVersion: this.#state.protocolVersion ?? null,
          frameCount: this.#frameCount,
          eventCount: this.#eventCount,
          exitCode,
          signal,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }

  #writeLine(descriptor: number, value: unknown): void {
    writeSync(descriptor, `${JSON.stringify(value)}\n`, undefined, "utf8");
  }
}
