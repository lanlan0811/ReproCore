# CLI reference

中文：[CLI 参考](cli.md)

## General conventions

```text
reprocore <command> [options]
```

Output files use exclusive creation so an existing capture, reduction result, or
archive is never silently overwritten. Path options accept relative or absolute
host paths and resolve them internally; paths written into a `.mincase` must be
portable and relative. `--json` emits a machine-readable summary. `capture` writes
that summary to stderr to preserve transparent stdio; other commands use stdout.

Stable exit codes:

| Code | Meaning                                                                |
| ---: | ---------------------------------------------------------------------- |
|    0 | Success or stable verification                                         |
|    1 | Execution failure, including an unavailable required doctor capability |
|    2 | Invalid arguments or input format                                      |
|    3 | Safety policy blocked the operation                                    |
|    4 | Unresolved result or explanatory-only output                           |
|    5 | Flaky baseline that this version cannot minimize reliably              |

## `doctor`

```bash
reprocore doctor [--json]
```

Checks the Node.js version, local fixture backend, and Docker backend. An
unavailable Docker daemon produces actionable diagnostics. Generated-fixture
workflows remain available when the safe local backend is ready.

## `capture`

```bash
reprocore capture --out <directory> [--include-content] [--json] -- <server> [args...]
```

Transparently proxies an MCP stdio server. Capture stores only structure, types,
lengths, and hashes by default; `--include-content` explicitly opts into content
storage. When enabled, the first credential scan happens before each frame is
written, and a match exits with code 3. The output directory contains
`capture.json`, `raw-frames.jsonl`, and `trace.jsonl`. When the content-enabled
capture has complete request/response pairs for a supported protocol, it also
creates `replay.fixture.json`. Never publish raw frames.

## `oracle init`

```bash
reprocore oracle init --out <oracle.yaml> [--name <name>] [--json]
```

Creates a version 1 Oracle template. Edit `rules` before running a baseline. Rule
types cover process exit, timeout, invalid JSON Schema, JSON Pointer, required or
forbidden tool calls, file hash, forbidden effects, and an isolated custom script.

## `replay`

```bash
reprocore replay --fixture <fixture.json> --oracle <oracle.yaml> [--repeat <1..100>] [--json]
```

Uses fixed responses and does not start a real server. The default repeat count
comes from the Oracle; three runs are recommended before minimization. If any run
no longer satisfies the Oracle, the command returns code 5 rather than claiming
that a flaky failure can be minimized.

## `minimize`

```bash
reprocore minimize --fixture <fixture.json> --oracle <oracle.yaml> \
  --out <fixture.json> [--proof <proof.json>] \
  [--cache <cache.sqlite>] [--budget-tests <count>] [--budget-ms <milliseconds>] [--json]
```

Runs dependency closure and transaction ddmin first, followed by Schema-aware
field reduction and unused-tool removal. The defaults allow 10,000 candidate tests
and ten minutes. The result is `oneMinimal` only after every single-element removal
check completes. Exhausting either budget returns code 4 and records
`budgetExhausted`. The proof ledger contains candidate hashes, outcomes, durations,
and cache hits, but no credential plaintext.

## `redact --check`

```bash
reprocore redact --check <path> [--json]
```

Scans without modifying input. A finding contains a category, relative source,
offset or file location, and SHA-256 fingerprint; it never echoes the match.
Credentials, sensitive query parameters, symbolic links, binary files, and unknown
attachments return code 3. Email addresses and absolute paths are marked for
deterministic replacement during export.

## `pack`

```bash
reprocore pack --fixture <fixture.json> --oracle <oracle.yaml> \
  --proof <proof.json> --out <name.mincase.zip> \
  [--name <name>] [--case-dir <name.mincase>] --confirm-export [--json]
```

Redacts the fixture, Oracle, and proof with one shared substitution map, scans the
result again, and performs a 5/5 replay. `--confirm-export` is mandatory; without it
the command creates neither a directory nor a ZIP. A result that cannot safely
reproduce is explanatory-only, while a failed safety scan blocks export entirely.
The deterministic archive excludes raw sessions, SQLite data, symbolic links, and
unexpected top-level files.

## `report`

```bash
reprocore report --case <name.mincase> [--out <report.html>] [--json]
```

Regenerates an offline report from the manifest, proof, and redaction proof. Every
value is HTML-escaped, the page contains no script, and a strict Content Security
Policy is enabled. ReproCore scans the generated page for sensitive content before
writing it.

## `verify`

```bash
reprocore verify --case <name.mincase> [--repeat <1..100>] [--json]
```

Checks the format major version and the trace, fixture, Oracle, and proof hashes,
then replays the fixed fixture. Five consecutive reproductions are required by
default. Verification is not a malicious-code sandbox; handle imported packages
according to the [security model](security.en.md).
