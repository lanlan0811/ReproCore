---
name: 缺陷报告
about: 报告不含敏感数据的可复现问题
title: "[Bug] "
labels: bug
---

安全漏洞请停止填写，并改用 SECURITY.md 的私下报告渠道。

## 问题描述

请说明预期行为与实际行为。

## 最小复现

提供已脱敏 fixture、命令和最少步骤。不要上传原始捕获、凭据或 SQLite 缓存。

## 环境

- ReproCore 版本：
- Node 版本：
- 操作系统：
- `reprocore doctor --json` 摘要：

## 安全检查

- [ ] 附件已运行 `reprocore redact --check`
- [ ] 不含 token、Cookie、个人路径或用户数据
