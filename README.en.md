# ReproCore

ReproCore is a local-first MCP failure minimizer. It reduces long, sensitive failure sessions into safe, executable `.mincase` reproduction packages that still trigger the same failure.

> Status: the v0.1.0 MVP is under development. Both the public CLI and npm package are named `reprocore`.

## Development

- Node.js 24 LTS recommended; Node.js 22.13 is the minimum
- pnpm 11.25.0
- Windows, macOS, and Linux

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
node packages/cli/dist/cli.js --version
```

The workspace contains nine packages: `format`, `protocol-mcp`, `capture-stdio`, `replay`, `oracles`, `minimizer`, `redaction`, `report`, and `cli`. Only the CLI is public in v0.1.0; all other packages remain private.

## License

[AGPL-3.0-only](LICENSE)

中文文档：[README.md](README.md)
