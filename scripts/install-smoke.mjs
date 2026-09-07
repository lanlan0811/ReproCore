import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageMetadata = JSON.parse(
  readFileSync(resolve("packages/cli/package.json"), "utf8"),
);
const tarball = resolve(
  process.argv[2] ??
    join("release", `${packageMetadata.name}-${packageMetadata.version}.tgz`),
);
const workspace = mkdtempSync(join(tmpdir(), "reprocore-install-smoke-"));

try {
  const npmCandidates = [
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(
      dirname(process.execPath),
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ];
  const npmCli = npmCandidates.find((candidate) => existsSync(candidate));
  const installCommand = npmCli === undefined ? "npm" : process.execPath;
  const installArguments = [
    ...(npmCli === undefined ? [] : [npmCli]),
    "install",
    "--prefix",
    workspace,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ];
  const install = spawnSync(installCommand, installArguments, {
    encoding: "utf8",
    shell: npmCli === undefined && process.platform === "win32",
    windowsHide: true,
  });
  if (install.status !== 0) throw new Error(install.stderr || install.stdout);
  const cli = join(workspace, "node_modules", "reprocore", "dist", "cli.cjs");
  const version = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (
    version.status !== 0 ||
    version.stdout.trim() !== packageMetadata.version
  ) {
    throw new Error(
      version.stderr || `Unexpected CLI version: ${version.stdout}`,
    );
  }
  process.stdout.write("Installed CLI smoke test passed\n");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
