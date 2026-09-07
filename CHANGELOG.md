# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，
版本号遵循语义化版本。发布前内容归入 Unreleased。

## [Unreleased]

### Added

- pnpm/TypeScript 九包工作区与 Windows、macOS、Linux CI。
- MCP stdio 字节透明捕获、stderr 分离和双协议规范化。
- 固定响应重放、版本化 Oracle、3/3 稳定性检查及安全本地/Docker 后端。
- 依赖闭包、事务 ddmin、Schema 感知 JSON reducer、SQLite 缓存和 proof ledger。
- 确定性 `.mincase.zip`、独立回归测试、双阶段脱敏与静态 HTML 报告。
- 30 个 seeded failure、5 个许可证明确的公开适配案例和逐核心包覆盖率门禁。
- 中英文 README、安装、CLI、架构、安全、格式、贡献、治理和行为准则文档。
- npm、Windows、macOS、Linux 三平台产物、SBOM、校验和、来源证明及 GitHub/Gitee
  镜像发布工作流。
- GitHub 可识别的双语缺陷模板、默认 PR 模板和结构化外部试用反馈表单。
- 安装、CLI、架构、安全和 `.mincase` 格式的完整中英文文档与双向导航。

### Security

- 内容捕获前凭据扫描；导出前二次扫描、显式确认和脱敏后 5/5 复验。
- 未识别附件、符号链接、原始帧、数据库和路径逃逸阻断。

### Fixed

- CLI 现在区分参数或输入格式错误、运行时执行失败、安全阻断和案例校验失败，并在 JSON
  错误摘要中返回对应的稳定退出码。
- Docker 后端现在强制镜像固定 SHA-256 digest，把正常完成的隔离脚本退出码传递给
  custom script Oracle，并记录调用及输出哈希；超时脚本保持 `UNRESOLVED`。
- Gitee Release 重跑会校验同名附件内容，并替换哈希不一致的远端产物。
- `verify` 与 `report` 现在会先验证完整 `.mincase` 目录，拒绝注入的未知文件、数据库和
  符号链接。
- 独立回归 runner 补齐常用 JSON Schema 2020-12 语义；无法等价支持的 Schema 自动
  生成 `explanatory` 案例。
- `.mincase` 导入与打包使用完整文件清单，拒绝任意目录中的未知附件或缺失标准文件。
- manifest 覆盖所有标准制品哈希，`verify` 可检测 runner、报告、Schema、来源与脱敏
  证明的内容篡改。
- `verify` 与 `report` 在读取导入案例前执行全目录安全扫描，拒绝包含敏感明文或二进制
  内容的案例，即使其 manifest 哈希也被同步修改。
- CLI 统一拒绝未知、重复及缺失值参数；`capture` 的任意 server 失败码稳定映射为
  ReproCore 执行失败码 1，同时在 JSON 摘要中保留原始 `serverExitCode`。
- `replay` 与 `minimize` 可用 digest 固定的 Docker 镜像执行单个 `custom_script`
  Oracle；候选通过 stdin 传入，镜像与超时参与缓存隔离，超时或输出超限的容器强制
  清理，且不会回退到宿主机执行。
- `minimize --json` 在基线未稳定复现时也输出完整判定摘要，并在创建缩减结果或 proof
  前以稳定退出码 5 停止。

## [0.1.0] - Unreleased

首个 MVP 版本。只有全部发布门禁、外部试用和三渠道发布完成后才填写发布日期并从
Unreleased 移动最终条目。
