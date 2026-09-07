# CLI 参考

## 通用约定

```text
reprocore <command> [options]
```

输出文件采用独占创建，避免静默覆盖已有捕获、缩减结果或压缩包。路径选项既接受
相对路径也接受绝对路径，内部统一解析；写入 `.mincase` 的路径必须是可移植相对
路径。`--json` 输出机器可读摘要。`capture` 为保持 stdio 透明性，把 JSON 摘要写到
stderr，其余命令写到 stdout。

稳定退出码：

| 代码 | 含义                                   |
| ---: | -------------------------------------- |
|    0 | 成功，或验证稳定通过                   |
|    1 | 执行失败，例如 doctor 的必需能力不可用 |
|    2 | 参数或输入格式错误                     |
|    3 | 安全策略阻断                           |
|    4 | 未解决或输出只能作为 explanatory case  |
|    5 | 基线抖动，当前版本不支持可靠缩减       |

## `doctor`

```bash
reprocore doctor [--json]
```

检查 Node 版本、本地 fixture 后端和 Docker 后端。Docker 不可用会给出可操作诊断；
本地安全后端可用时仍可处理只含生成 fixture 的流程。

## `capture`

```bash
reprocore capture --out <directory> [--include-content] [--json] -- <server> [args...]
```

在客户端与 MCP stdio server 之间进行透明代理。默认捕获只保存类型、长度和哈希；
`--include-content` 是保存原始内容的显式选择。启用内容时，首遍凭据扫描在每帧写盘
前执行，命中则退出码为 3。输出目录包含 `capture.json`、`raw-frames.jsonl` 和
`trace.jsonl`。当内容捕获包含已完成且版本受支持的请求响应时，还会生成
`replay.fixture.json`；不得把原始帧直接公开。

## `oracle init`

```bash
reprocore oracle init --out <oracle.yaml> [--name <name>] [--json]
```

创建版本 1 Oracle 模板。编辑 `rules` 后再运行基线。支持 process exit、timeout、
JSON Schema invalid、JSON pointer、tool called/forbidden tool、file hash、forbidden
effect 和隔离 custom script 规则。

## `replay`

```bash
reprocore replay --fixture <fixture.json> --oracle <oracle.yaml> [--repeat <1..100>] [--json]
```

固定响应重放，不启动真实 server。默认重复次数来自 Oracle；缩减前建议 3 次。只要
任一次不再满足 Oracle，就返回退出码 5，防止对抖动失败给出虚假最小化结果。

## `minimize`

```bash
reprocore minimize --fixture <fixture.json> --oracle <oracle.yaml> \
  --out <fixture.json> [--proof <proof.json>] \
  [--cache <cache.sqlite>] [--budget-tests <count>] [--budget-ms <milliseconds>] [--json]
```

先做事务依赖闭包与 ddmin，再执行 Schema 感知的字段缩减和未使用工具定义删除。
默认最多 10,000 次测试和 10 分钟。完成单项删除检查才报告 `oneMinimal`；达到预算
则返回退出码 4 并标记 `budgetExhausted`。proof ledger 记录候选哈希、结果、耗时与
缓存命中，不记录凭据明文。

## `redact --check`

```bash
reprocore redact --check <path> [--json]
```

只扫描，不修改输入。结果包含类别、相对来源、偏移或文件位置及 SHA-256 指纹，不
回显命中内容。凭据、敏感查询参数、符号链接、二进制或未知附件返回退出码 3；邮箱
和绝对路径会被标记，以便导出时确定性替换。

## `pack`

```bash
reprocore pack --fixture <fixture.json> --oracle <oracle.yaml> \
  --proof <proof.json> --out <name.mincase.zip> \
  [--name <name>] [--case-dir <name.mincase>] --confirm-export [--json]
```

共享一个替换映射脱敏 fixture、Oracle 和 proof，随后再次扫描并做 5/5 重放。
`--confirm-export` 必不可少；缺失时不会创建目录或 ZIP。不能安全复现的输出只允许
`explanatory`，安全扫描未通过则完全阻断。压缩包是确定性的，不包含原始会话、
SQLite、符号链接或意外顶层文件。

## `report`

```bash
reprocore report --case <name.mincase> [--out <report.html>] [--json]
```

从 manifest、proof 和 redaction proof 重新生成离线报告。所有值进行 HTML 转义，
报告不含脚本并启用严格 CSP。生成结果还会经过敏感内容扫描。

## `verify`

```bash
reprocore verify --case <name.mincase> [--repeat <1..100>] [--json]
```

校验格式主版本以及 trace、fixture、Oracle、proof 哈希，然后重放固定 fixture。
默认要求连续 5 次保持失败。此命令不等同于恶意代码沙箱；导入包仍应按
[安全文档](security.md)处理。

## English summary

Run `reprocore --help` for the compact command list. The main flow is `capture`,
`oracle init`, `replay`, `minimize`, `pack`, and `verify`. `redact --check`
performs a read-only safety scan, while `report` regenerates the offline HTML
report. Exit code 3 always means a safety policy blocked the operation.
