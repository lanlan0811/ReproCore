## 变更

说明动机、实现范围和用户可见结果。

## 风险

- 安全边界影响：
- 格式兼容性影响：
- Windows/macOS/Linux 影响：

## 验证

- [ ] `pnpm verify`
- [ ] `pnpm test:coverage`
- [ ] `pnpm benchmark`（影响缩减、Oracle 或重放时）
- [ ] `pnpm build && pnpm pack:cli && pnpm smoke:install`
- [ ] 已更新相关中英文文档与 CHANGELOG
- [ ] 不含凭据、原始捕获、缓存或被 `.gitignore` 隔离的内容
