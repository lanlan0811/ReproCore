# 架构

## 数据流

```text
MCP client <-> capture-stdio <-> MCP server
                   |
             raw hashes/events
                   |
          protocol normalization
                   |
          replay fixture + Oracle
                   |
       dependency closure and ddmin
                   |
       schema-aware JSON reducers
                   |
       redaction -> 5/5 verification
                   |
      .mincase directory + deterministic ZIP
```

捕获层只负责透明转发和证据记录，不在数据路径上改写 JSON-RPC。重放层使用固定响应
建立确定性观察值。Oracle 把“同一个失败”变为可重复判定的契约。缩减器仅接受通过
依赖与 Schema 快速验证的候选，所有执行结果以三态值表示，避免把基础设施错误当成
失败消失。

## 包职责

| 包              | 职责                                              |
| --------------- | ------------------------------------------------- |
| `format`        | 版本化 Schema、规范序列化、哈希、可移植包验证     |
| `protocol-mcp`  | 双协议档案、帧规范化、请求响应事务化、依赖信息    |
| `capture-stdio` | 字节透明代理、stderr 分离、首遍敏感扫描           |
| `replay`        | 固定 fixture、本地临时工作区、Docker 后端、doctor |
| `oracles`       | Oracle 文档与三态组合判定                         |
| `minimizer`     | 依赖闭包、ddmin、JSON reducer、SQLite 候选缓存    |
| `redaction`     | 双阶段扫描、确定性占位符、脱敏证明                |
| `report`        | 无脚本离线 HTML 报告与 XSS 转义                   |
| `cli`           | 公共命令、退出码、工作案例和打包编排              |

只有 `cli` 在 v0.1.0 对外发布。内部包通过 TypeScript project references 构建，
允许未来演进而不提前冻结 API。

## 协议档案

`legacy-2025-11-25` 要求有状态生命周期和 `initialize`；发现方法是 `tools/list`。
`modern-2026-07-28` 使用无状态生命周期与 `server/discover`。事件始终保留原始
`protocolVersion`，未知版本被拒绝，不能静默解释成较新的语义。

## 确定性与缓存

JSON 使用排序键规范化后计算 SHA-256。候选缓存键包含阶段命名空间与候选内容，
缓存只保存三态结果和耗时。ZIP 条目排序固定，mtime 固定为 ZIP 可表示的起始时间，
因此相同输入生成字节一致的包。

## 跨平台原则

- 使用 Node API 传递命令与参数，不拼接 shell 字符串。
- 案例内部路径统一使用 `/`，拒绝盘符、绝对路径和 `..`。
- 临时目录来自操作系统 API，并在验证目标位于预期临时根后清理。
- 不依赖原生 Node 扩展；SQLite 使用 Node 内置实现。
- CI 在 Windows、macOS、Linux 使用同一冻结 lockfile。

## English summary

ReproCore separates transparent capture, protocol normalization, deterministic
replay, Oracle evaluation, two-level minimization, redaction, and packaging into
nine focused packages. Data contracts are versioned, candidate outcomes are
three-state, and portable archives are deterministic across supported systems.
