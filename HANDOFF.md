# ReproCore v0.1.0 维护交接

## 当前状态

- 开发分支：`codex/reprocore-mvp`；不要新建分支或强推。
- GitHub 为主仓库，Gitee 为镜像；当前功能提交均已同步两个远端。
- 已完成捕获、双协议、重放、Oracle、安全后端、两级缩减、缓存、`.mincase`、
  双阶段脱敏、静态报告、30 个 seeded benchmark 与 5 个公开适配案例。
- 当前版本仍是发布候选，不得提前创建 `v0.1.0` tag。

## 必跑门禁

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm test:coverage
corepack pnpm benchmark
corepack pnpm build
corepack pnpm pack:cli
corepack pnpm smoke:install
```

核心包行覆盖率由 `scripts/verify-coverage.mjs` 逐包检查，不要用扩大依赖统计范围的方式
抬高数字。基准数据和许可证来源在 `benchmarks/` 与 `docs/benchmarking.md`。

## 发布前剩余事项

1. 由 2–5 名未参与实现的使用者按 `docs/external-testing.md` 完成真实试用并记录去敏结果。
2. 完成 release workflow 的 npm tarball、三平台归档、SBOM、SHA256SUMS、来源证明、
   GitHub Release 与 Gitee 镜像。
3. 配置 `NPM_TOKEN`、Gitee 发布 Token 和仓库保护；凭据缺失必须在任何发布前失败。
4. 确认 GitHub CI 在 Windows、macOS、Linux 和 Node 22.13/24 全绿。
5. 所有门禁满足后更新 CHANGELOG 日期，再创建并推送 `v0.1.0` tag。

## 安全提醒

原始 `raw-frames.jsonl`、SQLite 缓存、`.env`、私钥和 `.codex/` 内容均受
`.gitignore` 隔离。不要为了发布或调试修改隔离规则。任何外部案例先运行
`reprocore redact --check`，pack 必须保留 `--confirm-export` 和导出后 5/5 复验。
