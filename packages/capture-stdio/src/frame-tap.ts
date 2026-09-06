import { Transform, type TransformCallback } from "node:stream";

export interface FrameTapOptions {
  maxFrameBytes: number;
  onFrame: (frame: Buffer) => void;
}

export class FrameTap extends Transform {
  readonly #maxFrameBytes: number;
  readonly #onFrame: (frame: Buffer) => void;
  #pending = Buffer.alloc(0);

  public constructor(options: FrameTapOptions) {
    super();
    this.#maxFrameBytes = options.maxFrameBytes;
    this.#onFrame = options.onFrame;
  }

  public override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    try {
      this.#capture(bytes);
      callback(null, bytes);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public override _flush(callback: TransformCallback): void {
    try {
      if (this.#pending.length > 0) this.#emitFrame(this.#pending);
      this.#pending = Buffer.alloc(0);
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #capture(chunk: Buffer): void {
    let combined =
      this.#pending.length === 0
        ? chunk
        : Buffer.concat([this.#pending, chunk]);
    let newline = combined.indexOf(0x0a);
    while (newline >= 0) {
      let frame = combined.subarray(0, newline);
      if (frame.at(-1) === 0x0d) frame = frame.subarray(0, -1);
      this.#emitFrame(frame);
      combined = combined.subarray(newline + 1);
      newline = combined.indexOf(0x0a);
    }
    if (combined.length > this.#maxFrameBytes) {
      throw new Error(`MCP frame exceeds ${this.#maxFrameBytes} bytes`);
    }
    this.#pending = Buffer.from(combined);
  }

  #emitFrame(frame: Buffer): void {
    if (frame.length > this.#maxFrameBytes) {
      throw new Error(`MCP frame exceeds ${this.#maxFrameBytes} bytes`);
    }
    if (frame.length > 0) this.#onFrame(Buffer.from(frame));
  }
}
