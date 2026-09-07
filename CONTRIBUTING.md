# 贡献指南 / Contributing

感谢帮助改进 ReproCore。GitHub 是问题、Pull Request 和发布决策的主仓库；Gitee 仅
作为镜像。参与即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 开始之前

安全漏洞不要创建公开 Issue，请遵循 [SECURITY.md](SECURITY.md)。一般缺陷应包含
最小、已脱敏的 fixture 或 `.mincase`、预期行为、实际行为、操作系统、Node 版本和
`reprocore doctor --json` 摘要。不得上传真实 token、原始捕获或候选数据库。

## 开发环境

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm test:coverage
corepack pnpm benchmark
corepack pnpm build
corepack pnpm pack:cli
corepack pnpm smoke:install
```

推荐 Node.js 24 LTS，最低 Node.js 22.13。更改路径、进程或打包代码时，必须同时考虑
Windows 与 macOS/Linux，不可用 shell 拼接或平台专用硬编码解决。

## 变更要求

- 保持九包边界和版本化数据契约；格式破坏性变更必须提升主版本并补迁移说明。
- 新 reducer 必须有正例、负例、预算耗尽和 1-minimal 测试。
- 新 Oracle 必须证明缺失观察值返回 `UNRESOLVED`，不能误判为失败。
- 新导出内容必须进入白名单、哈希验证与二次敏感扫描。
- UI 或报告图标使用 SVG，不使用 emoji 充当图标。
- 用户可见行为同步更新中英文 README、CLI 参考和 CHANGELOG。
- 不提交 `.env`、原始会话、缓存、构建输出或 `.gitignore` 已隔离文件。

## Pull Request

从个人 fork 提交聚焦的 PR，说明动机、设计、安全影响、跨平台影响和验证命令。提交
信息应清晰描述完成的行为。维护者会以 GitHub CI、代码审查、安全边界和基准门禁
作为合并依据；合并后由维护流程同步 Gitee。

## English

Use GitHub for issues and pull requests. Never attach credentials, raw captures,
or candidate databases. Run `pnpm verify`, `pnpm test:coverage`, `pnpm benchmark`,
`pnpm build`, and the install smoke test before submitting. Every change must
preserve Windows/macOS compatibility, versioned contracts, export safety, and
the distinction between `UNRESOLVED` and a real failure outcome.
