# 基准与验收

## 数据集

`benchmarks/seeded-failures.json` 固定 1–30 共 30 个种子，在六类 Oracle 间轮换：
process exit、timeout、JSON Schema invalid、file hash、forbidden tool 和
forbidden effect。每个案例生成 31–60 个事务、协议依赖和含噪声 JSON payload。

`benchmarks/public-cases.json` 包含五个原创合成适配，灵感分别来自 MCP 官方
servers 仓库的 filesystem、memory、sequentialthinking、everything 和 time。
所有来源固定到 commit `d73f99efbfd40c3aa1b61e88728b3d49fb52608f`，文件中保存
源码路径、许可证表达式和许可证链接。适配未复制上游源码或用户数据。

## 运行

```bash
corepack pnpm benchmark
corepack pnpm test:coverage
```

基准直接调用生产 minimizer、Oracle、fixture Schema 和 3/3 基线验证。它不是只读取
预填结果的展示脚本。覆盖率命令只统计八个核心包的 `src`，随后逐包汇总并要求行
覆盖率至少 80%。

## v0.1.0 门禁

| 指标                  |     要求 | 当前确定性结果 |
| --------------------- | -------: | -------------: |
| Seeded failure 保留率 |     ≥95% |           100% |
| 正常案例误报率        |      ≤5% |             0% |
| 事务缩减率中位数      |     ≥70% |         94.52% |
| JSON 字段缩减率中位数 |     ≥50% |         92.86% |
| 典型运行时间          | ≤10 分钟 |  本机低于 1 秒 |
| 公开案例              |       ≥5 |  5，均通过 3/3 |

运行时间依赖硬件和并发负载，因此 CI 只强制 10 分钟上限，不把本机亚秒结果当作
跨机器性能承诺。事务与字段比例由固定种子和确定性算法得出。

## 公开案例许可证

上游仓库处于 Apache-2.0/MIT 许可证迁移期，根许可证明确包含两者。ReproCore 仅
保存接口启发的合成数据，并保留仓库、commit、组件路径与许可证 URL。详细声明见
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 外部试用

发布前的人类可用性检查按[外部试用清单](external-testing.md)执行。自动基准不能替代
2–5 名未参与开发的使用者对安装、错误信息、导出确认与报告可读性的验证。

## English summary

The acceptance suite runs 30 deterministic seeded failures through production
minimization code and validates five license-attributed public adaptations. The
current deterministic results are 100% retention, 0% false positives, 94.52%
median transaction reduction, and 92.86% median JSON field reduction.
