# Installation and upgrades

中文：[安装与升级](installation.md)

## Requirements

- Windows 10/11, a currently supported macOS release, or a mainstream Linux distribution.
- Node.js 22.13 or newer; Node.js 24 LTS is recommended.
- Docker Engine or Docker Desktop is required only for the hardened Docker replay backend.

The ReproCore npm package has no native addon, so the same tarball works on all
three operating-system families. Run `node --version` before installation and
confirm that it satisfies the minimum version.

## Install from npm

After the public release, install the pinned version globally:

```bash
npm install --global reprocore@0.1.0
reprocore --version
reprocore doctor
```

For CI or a temporary environment, use `npx reprocore@0.1.0 --help`. Production
automation should pin the version so behavior does not change without review.

## Install from source

```bash
git clone https://github.com/lanlan0811/ReproCore.git
cd ReproCore
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
```

The pnpm commands are identical in Windows PowerShell and macOS/Linux shells.
Some npm-based MCP servers need `cmd /c npx ...` in their server configuration
on Windows. ReproCore itself never concatenates a server command through a shell.

## Verify a local tarball

```bash
corepack pnpm pack:cli
corepack pnpm smoke:install
```

The smoke test creates an isolated project under the operating system's temporary
directory, installs the tarball, runs `--version` and `doctor --json`, and then
removes the temporary directory.

## Upgrade and uninstall

```bash
npm install --global reprocore@0.1.0
npm uninstall --global reprocore
```

An upgrade never migrates or deletes user cases. ReproCore checks the major
`formatVersion` when reading a `.mincase`; it rejects an unknown major version
instead of guessing compatibility.
