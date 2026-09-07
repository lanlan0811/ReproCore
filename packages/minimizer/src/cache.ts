import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CandidateResult } from "@reprocore/format";

export interface CachedCandidate {
  result: CandidateResult;
  durationMs: number;
}

export interface CandidateCacheLike {
  get(key: string): CachedCandidate | undefined;
  set(key: string, value: CachedCandidate): void;
}

interface CacheRow {
  result: CandidateResult;
  duration_ms: number;
}

export class CandidateCache implements CandidateCacheLike, Disposable {
  readonly #database: DatabaseSync;

  public constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(
      "CREATE TABLE IF NOT EXISTS candidates (key TEXT PRIMARY KEY, result TEXT NOT NULL, duration_ms INTEGER NOT NULL)",
    );
  }

  public get(key: string): CachedCandidate | undefined {
    const row = this.#database
      .prepare("SELECT result, duration_ms FROM candidates WHERE key = ?")
      .get(key) as CacheRow | undefined;
    return row === undefined
      ? undefined
      : { result: row.result, durationMs: row.duration_ms };
  }

  public set(key: string, value: CachedCandidate): void {
    this.#database
      .prepare(
        "INSERT INTO candidates (key, result, duration_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET result=excluded.result, duration_ms=excluded.duration_ms",
      )
      .run(key, value.result, value.durationMs);
  }

  public close(): void {
    this.#database.close();
  }

  public [Symbol.dispose](): void {
    this.close();
  }
}
