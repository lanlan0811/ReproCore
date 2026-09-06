# ReproCore

ReproCore 是一个本地优先的 MCP 失败最小化器。它将冗长、敏感的失败会话缩减为仍能触发同一失败的、安全且可执行的 `.mincase` 复现包。

> 当前状态：v0.1.0 MVP 正在开发。公开 CLI 名称与 npm 包名均为 `reprocore`。

## 开发环境

- 推荐 Node.js 24 LTS，最低支持 Node.js 22.13
- pnpm 11.25.0
- Windows、macOS 与 Linux

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
node packages/cli/dist/cli.js --version
```

工作区包含 `format`、`protocol-mcp`、`capture-stdio`、`replay`、`oracles`、`minimizer`、`redaction`、`report` 和 `cli` 九个包。v0.1.0 只发布 CLI，其余包暂时保持私有。

## 许可证

[AGPL-3.0-only](LICENSE)

English documentation: [README.en.md](README.en.md)
