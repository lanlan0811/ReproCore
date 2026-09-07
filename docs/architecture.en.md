# Architecture

中文：[架构](architecture.md)

## Data flow

```text
MCP client <-> capture-stdio <-> MCP server
                   |
             raw hashes/events
                   |
          protocol normalization
                   |
          replay fixture + Oracle
                   |
       dependency closure and ddmin
                   |
       schema-aware JSON reducers
                   |
       redaction -> 5/5 verification
                   |
      .mincase directory + deterministic ZIP
```

The capture layer only forwards bytes and records evidence; it does not rewrite
JSON-RPC in the data path. Replay uses fixed responses to produce a deterministic
observation. An Oracle turns “the same failure” into an auditable contract. The
minimizer accepts a candidate only after dependency and Schema validation, and
every candidate result is three-state so infrastructure errors are not mistaken
for a disappearing failure.

## Package responsibilities

| Package         | Responsibility                                                                   |
| --------------- | -------------------------------------------------------------------------------- |
| `format`        | Versioned Schemas, canonical serialization, hashes, and portable-case validation |
| `protocol-mcp`  | Two protocol profiles, frame normalization, transactions, and dependencies       |
| `capture-stdio` | Byte-transparent proxying, separate stderr, and first-pass secret scanning       |
| `replay`        | Fixed fixtures, disposable local workspaces, Docker backend, and doctor checks   |
| `oracles`       | Versioned Oracle documents and three-state combination                           |
| `minimizer`     | Dependency closure, ddmin, JSON reducers, and SQLite candidate cache             |
| `redaction`     | Two-pass scanning, deterministic placeholders, and redaction proofs              |
| `report`        | Script-free offline HTML reports and XSS escaping                                |
| `cli`           | Public commands, exit codes, working cases, and packaging orchestration          |

Only the `cli` package is published for v0.1.0. Internal packages use TypeScript
project references so they can evolve without prematurely freezing an API.

## Protocol profiles

`legacy-2025-11-25` uses a stateful lifecycle with `initialize`, and discovers
tools through `tools/list`. `modern-2026-07-28` uses a stateless lifecycle and
`server/discover`. Events retain their original `protocolVersion`; unknown
versions are rejected and are never silently interpreted using newer semantics.

## Determinism and caching

ReproCore hashes JSON after canonical key sorting. A candidate-cache key includes
the stage namespace and candidate content; the cache stores only the three-state
result and duration. ZIP entries are sorted and use a fixed earliest ZIP timestamp,
so the same normalized input produces byte-identical archives.

## Cross-platform rules

- Commands and arguments use Node.js process APIs rather than concatenated shell strings.
- Paths inside cases use `/` and reject drive letters, absolute paths, and `..`.
- Temporary directories come from the operating system and are removed only after their resolved location is verified.
- No native Node.js addon is required; SQLite uses the Node.js built-in implementation.
- CI uses the same frozen lockfile on Windows, macOS, and Linux.
