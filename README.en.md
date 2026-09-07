# ReproCore

[![CI](https://github.com/lanlan0811/ReproCore/actions/workflows/ci.yml/badge.svg)](https://github.com/lanlan0811/ReproCore/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

ReproCore is a local-first MCP failure minimizer. It turns long, sensitive MCP
stdio sessions into safe, auditable, standalone `.mincase` reproductions that
continue to trigger the same failure.

The project is currently preparing the v0.1.0 release candidate. The public npm
package and command are both named `reprocore`; the eight internal libraries do
not yet provide a stable public programming API.

## Capabilities

- Proxies MCP stdio byte-for-byte while preserving stdout order, content, and request IDs, with stderr kept separate.
- Supports the `2025-11-25` and `2026-07-28` profiles without silently upgrading captured traffic.
- Evaluates versioned Oracles for exit codes, timeouts, schemas, JSON pointers, tool calls, file hashes, and effects.
- Combines dependency closure, transaction ddmin, and schema-aware JSON reducers, reporting either 1-minimal or budget-exhausted results.
- Replays generated fixtures in disposable local workspaces or a hardened Docker container, with 3/3 baseline and 5/5 post-export checks.
- Redacts credentials, sensitive URL parameters, email addresses, and absolute paths in two passes; unknown attachments and symlinks block export.
- Produces deterministic `.mincase.zip` archives, standalone `node:test` regression tests, and script-free offline HTML reports with CSP.

## Install

Node.js 22.13 or newer is required; Node.js 24 LTS is recommended.

```bash
npm install --global reprocore
reprocore doctor
```

For source development:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
node packages/cli/dist/cli.cjs --version
```

## Basic workflow

```bash
# Content is omitted by default; recording it requires an explicit opt-in.
reprocore capture --out runs/example --include-content -- your-mcp-server

reprocore oracle init --out failure.oracle.yaml --name wrong-target
reprocore replay --fixture runs/example/replay.fixture.json --oracle failure.oracle.yaml --repeat 3
reprocore minimize --fixture runs/example/replay.fixture.json --oracle failure.oracle.yaml \
  --out minimized.json --proof minimized.proof.json
reprocore pack --fixture minimized.json --oracle failure.oracle.yaml \
  --proof minimized.proof.json --out wrong-target.mincase.zip --confirm-export
reprocore verify --case wrong-target.mincase --repeat 5
```

Without `--confirm-export`, `pack` exits with code 3 and creates no case. Raw
frames and local SQLite caches are never included in a portable archive. See the
[CLI reference](docs/cli.md) for all options.

## Security model

The local backend runs only generated fixtures, never a real server or arbitrary
script. Use the Docker backend for real servers, custom Oracle scripts, or
strict network isolation. Treat every imported `.mincase` as untrusted and run
`reprocore verify` first. See the [security model](docs/security.md) and
[security policy](SECURITY.md).

## Quality status

- 30 deterministic seeded failures: 100% retention and 0% false positives on normal cases.
- Median transaction reduction: 94.52%; median JSON field reduction: 92.86%.
- Five license-attributed public MCP server adaptations reproduce 3/3.
- Every core package has an enforced 80% line-coverage gate.
- CI covers Node 24 on Windows, macOS, and Linux, plus Node 22.13 compatibility.

Run `pnpm benchmark` to reproduce the acceptance suite. Sources, licensing, and
methodology are documented in [benchmarking](docs/benchmarking.md).

## Documentation and community

- [Installation](docs/installation.en.md)
- [CLI reference](docs/cli.en.md)
- [Architecture](docs/architecture.en.md)
- [Security model](docs/security.en.md)
- [`.mincase` format](docs/mincase-format.en.md)
- [Release process](docs/releasing.md)
- [Contributing](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)

GitHub is the primary repository; Gitee is a mirror. Issues, patches, and release
decisions are authoritative on GitHub.

## License

[AGPL-3.0-only](LICENSE). The public benchmark adaptations contain no upstream
source code; attribution is recorded in [third-party notices](THIRD_PARTY_NOTICES.md).

中文：[README.md](README.md)
