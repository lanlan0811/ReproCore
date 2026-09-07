# 项目治理 / Governance

ReproCore 采用维护者主导、公开讨论的轻量治理模型。GitHub 是权威协作与发布记录；
Gitee 是只读意义上的同步镜像。

## 角色

- 贡献者：提交 Issue、文档、测试或代码的任何人。
- 审阅者：持续提供高质量审查并熟悉相关模块的贡献者。
- 维护者：拥有合并、发布、安全响应和治理决策权限的人。

当前项目维护者为 GitHub 用户 `lanlan0811`。新增维护者需要持续贡献、可靠审查、
安全判断能力和现有维护者公开确认。角色变更记录在本文件的提交历史中。

## 决策

普通变更通过 PR 审查和 CI 决定。格式主版本、安全边界、许可证、发布渠道或治理变化
必须先有公开设计 Issue，并保留合理评论期。维护者优先寻求共识；无法达成时，由
维护者依据用户安全、兼容性和项目范围作出记录充分的最终决定。

安全事件可以先私下修复，再在风险解除后公开说明。紧急修复不得绕过测试、产物哈希
或发布凭据预检。

## 发布

发布必须满足计划中的质量门禁，由维护者从受保护的 GitHub tag 触发。npm、GitHub
Release 和 Gitee 镜像使用相同已校验产物。任何渠道失败都应被视为未完成发布，并按
发布文档恢复或重试。

## English

ReproCore uses maintainer-led, publicly documented governance. Routine decisions
are made through GitHub pull requests and CI. Changes to format major versions,
security boundaries, licensing, release channels, or governance require a
public design discussion. Security incidents may be handled privately until
coordinated disclosure is safe.
