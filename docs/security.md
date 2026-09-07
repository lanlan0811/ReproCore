# 安全模型

English: [Security model](security.en.md)

## 保护目标

ReproCore 的首要目标是避免在捕获、缩减和公开复现过程中泄露凭据或让不可信输入
越过工作区边界。其次是保证“失败仍存在”的结论来自可审计 Oracle，而不是执行器
崩溃、网络波动或缓存污染。

## 信任边界

- MCP server、捕获内容、导入的 `.mincase`、Oracle 文本和报告字段均不可信。
- 本地生成的 runner 可信，但只能解释 ReproCore 生成的 fixture plan。
- Docker daemon 是可选的外部信任根；Docker 不可用时不得降级执行真实 server。
- 原始捕获目录与候选 SQLite 属于本地敏感数据，永不属于公开案例格式。

## 捕获与脱敏

默认捕获不保存消息内容，只保存结构、类型、长度和哈希。显式
`--include-content` 后，API key、Authorization/Bearer、Cookie、OAuth code、
private key 和常见 token 形态在写入每帧前扫描。导出时，fixture、Oracle 和 proof
共享确定性替换映射，邮箱、绝对路径与 URL 查询值也被替换。第二遍扫描必须无阻断
项，脱敏版本还必须连续复现 5 次。

扫描结果只记录类别、来源位置和不可逆 SHA-256 指纹，不记录命中明文。未知扩展、
二进制附件和符号链接无法被可靠检查，因此直接阻断公开导出。扫描器是纵深防御，
不能替代导出者对内容的人工审阅。

## 重放隔离

本地后端的限制：

- 仅运行生成的 fixture runner，不启动真实 server 或 custom script。
- 每次使用全新系统临时目录，环境变量只保留显式白名单。
- 拒绝绝对路径、父目录逃逸和符号链接逃逸。
- 超时后终止进程树，收集结果后验证清理目标仍位于临时根。

Docker 后端用于更高风险输入，参数固定包含无网络、非 root、只读根文件系统、受限
CPU/内存/PID 与受限临时文件系统。后端拒绝没有固定 SHA-256 digest 的镜像；使用者仍
需完成镜像供应链审核。后端把正常完成的隔离进程退出码作为 custom script Oracle 的
观察值；候选 fixture 仅通过 stdin 输入，不挂载宿主目录。超时或输出超过采集上限时
保持 `UNRESOLVED`；后端会按随机容器名执行强制删除，删除失败即报错。它只保留调用、
stdout 和 stderr 的 SHA-256 审计摘要，不把输出内容写入案例包。

## 报告与导入包

报告转义所有不可信字段，无 JavaScript，CSP 默认为 `default-src 'none'`。视觉标记
使用内联 SVG。`.mincase` 验证器拒绝任意目录层级的清单外文件、符号链接、数据库、
原始帧和未知格式主版本，并检查全部标准制品哈希。

不要双击或直接执行未知包中的其他文件。先解压到隔离目录，检查 manifest 和
redaction proof，运行 `reprocore verify`；对于来源不明或包含 custom script 的
explanatory case，使用一次性容器进行人工分析。

## 已知限制

- 正则与键名扫描无法证明不存在所有业务私密信息。
- SHA-256 指纹可能对低熵值产生字典猜测风险，因此不应将短个人标识当作安全证明。
- v0.1.0 的本地固定响应重放模拟 MCP 观察值，不替代真实 server 的完整行为测试。
- Docker 的无网络约束依赖本机 Docker daemon 正确执行。

漏洞请按仓库根目录 [SECURITY.md](../SECURITY.md) 私下报告。
