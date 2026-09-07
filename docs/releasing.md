# 发布流程

ReproCore 的 GitHub tag 工作流是唯一正式发布入口。工作流先完成凭据门禁，再在 Node 24
上运行全部质量、覆盖率、基准、构建、打包和安装冒烟测试；同时在 GitHub 托管的
Windows、macOS 与 Linux runner 上生成平台归档。任何验证失败都不会进入发布任务。

## 一次性仓库配置

在 GitHub Actions 中创建受保护的 `release` environment。以下值配置为仓库级
Actions secrets/variables，以便最先运行的前置任务能在构建前验证它们：

- Secret `NPM_TOKEN`：只允许发布 `reprocore` 的 npm granular access token；
- Secret `GITEE_ACCESS_TOKEN`：只授予目标镜像仓库 Release 所需权限；
- Variable `GITEE_OWNER`：Gitee 空间路径；
- Variable `GITEE_REPO`：Gitee 仓库路径。

发布前置任务会同时检查这四项。任一项缺失时，工作流在检出、构建或发布任何产物前
明确失败，避免因为配置缺失造成半发布。GitHub 自带的短期 token 用于 GitHub Release，
OIDC 则用于 GitHub SLSA 来源证明和 npm provenance。

## 发布门禁

1. 2–5 名未参与实现的试用者完成 `docs/external-testing.md`，结果不得包含敏感内容；
2. `master` 上最新 CI 的 Node 24 三平台任务和 Node 22.13 兼容任务全部成功；
3. `CHANGELOG.md` 将待发布条目移动到 `0.1.0` 并填写实际发布日期；
4. npm 与 Gitee 配置已由维护者在受保护 environment 中复核；
5. 在 `master` 当前提交创建签名或受保护 tag，并将同一 tag 推送到 GitHub 与 Gitee。

不得通过手工上传替代工作流，也不得重用失败运行产生的局部产物。若任一渠道失败，版本
仍视为未完成发布，修复原因后重新运行同一 tag 的完整工作流。

## 产物与验证

每次发布包含 npm tarball、Windows ZIP、macOS universal tarball、Linux tarball、
CycloneDX JSON SBOM、`SHA256SUMS` 和 Sigstore 来源证明 bundle。GitHub Release 与
Gitee Release 上传完全相同的文件。

下载后可验证哈希：

```bash
sha256sum --check SHA256SUMS
gh attestation verify reprocore-0.1.0.tgz --repo lanlan0811/ReproCore
```

PowerShell 可使用 `Get-FileHash -Algorithm SHA256 <文件>`，并与 `SHA256SUMS` 对照。
npm 包另带 npm registry 发布的 provenance。
