# 安全策略 / Security Policy

## 支持范围

在 v0.1 系列正式发布后，仅最新补丁版本接收安全修复。发布前的 commit 仅供评估，
不提供生产安全保证。安全公告会说明受影响版本、缓解措施和修复版本。

## 私下报告

请使用 GitHub 仓库的
[Private vulnerability reporting](https://github.com/lanlan0811/ReproCore/security/advisories/new)
提交报告。不要创建公开 Issue，不要附带真实凭据、用户数据或未经脱敏的捕获。

报告应包含：

- 受影响版本或 commit；
- 威胁场景和可观察影响；
- 仅使用合成数据的最小复现；
- 已知前置条件和建议缓解措施；
- 是否已在其他地方披露。

维护者目标是在 3 个工作日内确认收到，在 7 个工作日内给出初步分级。修复时间取决
于复杂度；协调披露前会与报告者沟通。若 GitHub 私下报告入口不可用，请不要公开
细节，先通过仓库所有者的 GitHub 个人资料请求建立私密联系渠道。

## 优先关注范围

- 捕获或导出泄露密钥、Cookie、OAuth code 或原始会话；
- 路径、符号链接或压缩包逃逸；
- 本地或 Docker 重放绕过隔离、环境白名单或禁网约束；
- 恶意 `.mincase` 导致任意代码执行或完整性验证绕过；
- 报告 XSS、CSP 绕过或脱敏证明伪造；
- 供应链、发布来源证明或哈希校验缺陷。

一般崩溃、性能问题和不含敏感数据的兼容性问题可以创建普通 Issue。

## English

Report vulnerabilities privately through GitHub Security Advisories. Do not
open a public issue or include real secrets or user captures. Include the
affected version, impact, synthetic reproduction, prerequisites, and proposed
mitigation. We aim to acknowledge reports within three business days.
