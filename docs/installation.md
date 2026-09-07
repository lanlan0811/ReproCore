# 安装与升级

English: [Installation and upgrades](installation.en.md)

## 运行要求

- Windows 10/11、当前 macOS 或主流 Linux 发行版。
- Node.js 22.13 及以上；推荐 Node.js 24 LTS。
- 只有使用 Docker 隔离后端时才需要 Docker Engine 或 Docker Desktop。

ReproCore 的 npm 包不包含原生扩展，因此同一 tarball 可用于三个操作系统。先运行
`node --version`，确认版本满足要求。

## npm 安装

正式发布后可全局安装：

```bash
npm install --global reprocore@0.1.0
reprocore --version
reprocore doctor
```

也可在 CI 或临时环境中使用 `npx reprocore@0.1.0 --help`。生产脚本应固定版本，
避免不经审核自动切换行为。

## 从源码安装

```bash
git clone https://github.com/lanlan0811/ReproCore.git
cd ReproCore
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
```

Windows PowerShell、macOS/Linux shell 使用相同的 pnpm 命令。Windows 启动某些
npm MCP server 时可能需要在 server 配置中使用 `cmd /c npx ...`；ReproCore
自身不会通过 shell 拼接 server 命令。

## 校验本地 tarball

```bash
corepack pnpm pack:cli
corepack pnpm smoke:install
```

安装冒烟会在系统临时目录创建一个隔离项目，安装 tarball，执行 `--version` 和
`doctor --json`，随后删除临时目录。

## 升级与卸载

```bash
npm install --global reprocore@0.1.0
npm uninstall --global reprocore
```

升级不会迁移或删除用户案例。读取 `.mincase` 时按 `formatVersion` 主版本检查；
未知主版本会被拒绝，而不是猜测兼容性。
