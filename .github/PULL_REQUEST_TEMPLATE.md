## 变更 / Change

说明动机、实现范围和用户可见结果。

Explain the motivation, scope, and user-visible outcome.

## 风险 / Risk

- 安全边界影响 / Security-boundary impact:
- 格式兼容性影响 / Format-compatibility impact:
- Windows/macOS/Linux 影响 / Platform impact:

## 验证 / Verification

- [ ] `pnpm verify`
- [ ] `pnpm test:coverage`
- [ ] `pnpm benchmark`（影响缩减、Oracle 或重放时 / when minimization, Oracles, or replay changed）
- [ ] `pnpm build && pnpm pack:cli && pnpm smoke:install`
- [ ] 已更新相关中英文文档与 CHANGELOG / Relevant documentation and CHANGELOG are updated
- [ ] 不含凭据、原始捕获、缓存或被 `.gitignore` 隔离的内容 / No credentials, raw captures, caches, or ignored local files are included
