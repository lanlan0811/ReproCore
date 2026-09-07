# ReproCore

[![CI](https://github.com/lanlan0811/ReproCore/actions/workflows/ci.yml/badge.svg)](https://github.com/lanlan0811/ReproCore/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

ReproCore 是一个本地优先的 MCP 失败最小化器。它把冗长、敏感的
MCP stdio 会话缩减为仍能稳定触发同一失败的、安全、可审计且可独立执行的
`.mincase` 复现包。

当前状态为 v0.1.0 发布候选开发阶段。公开 npm 包和命令均为 `reprocore`；
内部八个库暂不承诺稳定编程 API。

## 能做什么

- 字节级代理 MCP stdio，保持 stdout 顺序、内容和请求 ID，并单独记录 stderr。
- 原样支持 `2025-11-25` 与 `2026-07-28` 两个协议档案，不静默升级。
- 通过版本化 Oracle 对退出码、超时、Schema、JSON 指针、工具调用、文件哈希和副作用进行判定。
- 使用依赖闭包、事务级 ddmin 和 Schema 感知 JSON reducer 缩减到 1-minimal 或明确标记预算耗尽。
- 在临时工作区或加固 Docker 容器中重放，并执行 3/3 基线与导出后 5/5 复验。
- 双阶段扫描密钥、Cookie、OAuth code、敏感 URL、邮箱和绝对路径；未识别附件与符号链接阻断导出。
- 生成确定性 `.mincase.zip`、独立 `node:test` 回归测试和无脚本、带 CSP 的离线 HTML 报告。

## 安装

需要 Node.js 22.13 或更高版本，推荐 Node.js 24 LTS。

```bash
npm install --global reprocore
reprocore doctor
```

从源码开发：

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
node packages/cli/dist/cli.cjs --version
```

## 基本流程

```bash
# 默认只落盘结构、长度和哈希；显式选择后才保存内容
reprocore capture --out runs/example --include-content -- your-mcp-server

reprocore oracle init --out failure.oracle.yaml --name wrong-target
reprocore replay --fixture runs/example/replay.fixture.json --oracle failure.oracle.yaml --repeat 3
reprocore minimize --fixture runs/example/replay.fixture.json --oracle failure.oracle.yaml \
  --out minimized.json --proof minimized.proof.json
reprocore pack --fixture minimized.json --oracle failure.oracle.yaml \
  --proof minimized.proof.json --out wrong-target.mincase.zip --confirm-export
reprocore verify --case wrong-target.mincase --repeat 5
```

`pack` 没有 `--confirm-export` 时以退出码 3 阻断，且不创建案例。捕获产物中的
`raw-frames.jsonl` 和本地 SQLite 缓存永远不会进入公开包。详细参数见
[CLI 文档](docs/cli.md)。

## 安全模型

本地后端只运行 ReproCore 生成的 fixture，不运行真实 server 或任意脚本。真实
server、自定义 Oracle 脚本以及需要强制断网的重放应使用 Docker 后端。任何
`.mincase` 都应被视为不可信输入；运行前先用 `reprocore verify` 校验。完整边界、
威胁模型和漏洞报告方式见[安全文档](docs/security.md)与[安全策略](SECURITY.md)。

## 质量状态

- 30 个确定性 seeded failure：保留率 100%，正常案例误报率 0%。
- 事务缩减率中位数 94.52%，JSON 字段缩减率中位数 92.86%。
- 5 个许可证明确的公开 MCP server 场景适配均通过 3/3。
- 核心包逐包行覆盖率门禁为 80%。
- CI 覆盖 Windows、macOS、Linux 的 Node 24，并单独验证 Node 22.13。

运行 `pnpm benchmark` 可复核验收指标；来源、许可证与方法见
[基准说明](docs/benchmarking.md)。

## 文档与参与

- [安装](docs/installation.md)
- [CLI 参考](docs/cli.md)
- [架构](docs/architecture.md)
- [安全模型](docs/security.md)
- [`.mincase` 格式](docs/mincase-format.md)
- [发布流程](docs/releasing.md)
- [贡献指南](CONTRIBUTING.md)
- [治理](GOVERNANCE.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [变更日志](CHANGELOG.md)

GitHub 是主仓库，Gitee 是镜像。问题、补丁和发布判断以 GitHub 为准。

## 许可证

[AGPL-3.0-only](LICENSE)。公开基准适配不包含上游源码；相关归属见
[第三方声明](THIRD_PARTY_NOTICES.md)。

English: [README.en.md](README.en.md)
