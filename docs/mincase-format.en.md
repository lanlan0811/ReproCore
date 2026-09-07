# `.mincase` format

中文：[`.mincase` 格式](mincase-format.md)

## Directory and archive

A working case is named `<name>.mincase/`; its public artifact is
`<name>.mincase.zip`. A name contains at most 80 lowercase ASCII letters, digits,
dots, underscores, or hyphens and starts with a letter or digit. The ZIP has
exactly one top-level directory: the corresponding working case.

```text
name.mincase/
  manifest.yaml
  trace.jsonl
  oracle.yaml
  provenance.json
  redaction.yaml
  report.html
  package.json
  artifacts/proof.json
  fixtures/replay.json
  runner/oracle.json
  runner/replay-server.mjs
  runner/regression.test.mjs
  schemas/replay-fixture.schema.json
```

Raw `raw-frames.jsonl`, SQLite or DB files, candidate caches, raw session
directories, symbolic links, and unknown top-level entries are forbidden.

## `manifest.yaml`

`formatVersion` follows semantic versioning. A reader automatically accepts only
the same major version. The manifest also records:

- the name, `executable` or `explanatory` case type, and `oneMinimal` or `budgetExhausted` status;
- the original protocol profile, lifecycle, discovery method, and log-transport semantics;
- transaction and JSON-field counts before and after reduction;
- `sha256:` hashes for the fixture, Oracle, proof, and trace;
- a complete artifact-hash table for package, provenance, redaction proof,
  report, Schema, and runner files;
- reducer identities, the 3/3 baseline, and the final 5/5 verification; and
- redaction verification, sensitivity, and explicit export confirmation.

Unknown fields are rejected so misspellings or unnegotiated semantics cannot be
silently ignored.

## Trace and fixture

Each `trace.jsonl` line is one minimized transaction record.
`fixtures/replay.json` is a version 1 fixed-response fixture containing the
original `protocolVersion`, at least one request/response exchange, portable
virtual files, and an observation seed. Replay replaces the stored JSON-RPC
response ID with the corresponding incoming request ID.

`oracle.yaml` is the human-readable, versioned failure contract. The runner also
contains equivalent JSON so `node --test runner/regression.test.mjs` works without
ReproCore or any third-party npm package.

The dependency-free runner implements equivalent common JSON Schema 2020-12
composition, object, array, string, and numeric constraints. A case using `$ref`,
dynamic references, or another Schema keyword that cannot be reproduced
equivalently is marked `explanatory`.

## Proof and redaction proof

`artifacts/proof.json` records both minimization stages: candidate ledgers,
removed elements, outcomes, durations, cache hits, and minimality status.
`redaction.yaml` is fixed at version 1 with `passes: 2`; it records verification
and replay state plus plaintext-free findings and deterministic substitution
fingerprints.

## Deterministic encoding

ZIP entries use portable path order, a fixed `1980-01-01T00:00:00Z` timestamp,
and a fixed compression level. The same normalized input must produce exactly the
same bytes. Text files are UTF-8 with LF line endings, and all paths inside the
case use `/`.

## Compatibility rules

- Unknown format major version: reject.
- Unknown or extra Schema fields in a known major version: reject.
- Unknown MCP protocol version: reject without silent upgrade.
- Missing standard files or unlisted files at any directory level: reject.
- Content-hash mismatch: reject verification and replay.
- Failed safety proof: do not create a public ZIP.
