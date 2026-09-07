# `.mincase` 格式

## 目录和压缩包

工作案例名为 `<name>.mincase/`，公开产物名为 `<name>.mincase.zip`。名称仅允许小写
字母、数字、点、下划线和连字符，最长 80 字符。ZIP 的唯一顶层目录必须是对应工作
案例目录。

```text
name.mincase/
  manifest.yaml
  trace.jsonl
  oracle.yaml
  provenance.json
  redaction.yaml
  report.html
  package.json
  artifacts/proof.json
  fixtures/replay.json
  runner/oracle.json
  runner/replay-server.mjs
  runner/regression.test.mjs
  schemas/replay-fixture.schema.json
```

原始 `raw-frames.jsonl`、SQLite/DB、候选缓存、原始会话目录、符号链接和未知顶层
条目被禁止。

## `manifest.yaml`

`formatVersion` 使用语义化版本。读取器只自动接受相同主版本。manifest 还包含：

- 名称、`executable`/`explanatory` 类型和 `oneMinimal`/`budgetExhausted` 状态。
- 原始协议档案及生命周期、发现方法、日志传输语义。
- 缩减前后事务数和 JSON 字段数。
- fixture、Oracle、proof、trace 的 `sha256:` 哈希。
- reducer 集合、3/3 基线、5/5 最终验证。
- 脱敏复验、敏感级别和用户导出确认状态。

未知字段会被拒绝，防止拼写错误或未协商语义被忽略。

## 轨迹与 fixture

`trace.jsonl` 每行是一个最小事务记录。`fixtures/replay.json` 是版本 1 固定响应
fixture，包含原始 `protocolVersion`、至少一个请求响应 exchange、可移植虚拟文件与
观察种子。JSON-RPC 响应 ID 在重放时与对应请求 ID 关联。

`oracle.yaml` 是人类可读、版本化的失败判定；runner 中同时放置等价 JSON，确保
独立 `node --test runner/regression.test.mjs` 不依赖 ReproCore 或第三方 npm 包。

## Proof 与脱敏证明

`artifacts/proof.json` 记录两级缩减的候选账本、删除项、结果、耗时、缓存命中与
最小性状态。`redaction.yaml` 固定为 version 1、passes 2，保存验证状态、重放状态、
无明文 finding 与确定性 substitution 指纹。

## 确定性编码

ZIP 条目按可移植路径排序，mtime 固定为 `1980-01-01T00:00:00Z`，压缩级别固定。
同一规范化输入必须生成字节完全相同的 ZIP。文本文件使用 UTF-8 和 LF；路径分隔符
在案例内部统一为 `/`。

## 兼容性规则

- 未知格式主版本：拒绝。
- 已知主版本中的未知/额外 Schema 字段：拒绝。
- 未知 MCP 协议版本：拒绝，不静默升级。
- 哈希不一致：拒绝验证与重放。
- 安全证明失败：不得生成公开 ZIP。

## English summary

A `.mincase` is a versioned working directory and a deterministic ZIP archive.
It contains only minimized traces, fixtures, Oracles, proofs, schemas, an
offline report, and a dependency-free regression runner. Raw sessions, caches,
databases, symlinks, and unexpected top-level entries are forbidden.
