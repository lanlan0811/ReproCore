import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function packageUrl(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${version}`;
}

export function buildCycloneDx(licenseReport, packageMetadata) {
  const components = [];
  const seen = new Set();

  for (const [license, packages] of Object.entries(licenseReport)) {
    for (const dependency of packages) {
      for (const version of dependency.versions ?? []) {
        const key = `${dependency.name}@${version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const purl = packageUrl(dependency.name, version);
        const component = {
          type: "library",
          "bom-ref": purl,
          name: dependency.name,
          version,
          licenses: [{ expression: license }],
          purl,
        };
        if (dependency.homepage) {
          component.externalReferences = [
            { type: "website", url: dependency.homepage },
          ];
        }
        components.push(component);
      }
    }
  }

  components.sort((left, right) =>
    left["bom-ref"].localeCompare(right["bom-ref"]),
  );
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": packageUrl(packageMetadata.name, packageMetadata.version),
        name: packageMetadata.name,
        version: packageMetadata.version,
        licenses: [{ license: { id: packageMetadata.license } }],
        purl: packageUrl(packageMetadata.name, packageMetadata.version),
      },
    },
    components,
  };
}

export function createChecksums(directory) {
  return (
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS")
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const digest = createHash("sha256")
          .update(readFileSync(join(directory, entry.name)))
          .digest("hex");
        return `${digest}  ${entry.name}`;
      })
      .join("\n") + "\n"
  );
}

export function findPackageTarball(directory, packageMetadata) {
  const expected = `${packageMetadata.name}-${packageMetadata.version}.tgz`;
  const tarball = join(directory, expected);
  if (!readdirSync(directory).includes(expected)) {
    throw new Error(`Missing npm tarball: ${expected}`);
  }
  return tarball;
}

function readPackageMetadata() {
  return JSON.parse(
    readFileSync(
      join(workspaceRoot, "packages", "cli", "package.json"),
      "utf8",
    ),
  );
}

function findOwningPackage(sourcePath) {
  let current = dirname(sourcePath);
  const dependencyRoot = join(workspaceRoot, "node_modules");
  while (current.startsWith(dependencyRoot)) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name && manifest.version) return manifest;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function runtimeLicenseReport() {
  const sourceMapPath = join(
    workspaceRoot,
    "packages",
    "cli",
    "dist",
    "cli.cjs.map",
  );
  if (!existsSync(sourceMapPath)) {
    throw new Error("CLI source map is required to generate the runtime SBOM");
  }
  const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));
  const packages = new Map();
  for (const source of sourceMap.sources) {
    if (!source.includes("node_modules")) continue;
    const manifest = findOwningPackage(resolve(dirname(sourceMapPath), source));
    if (!manifest?.name || !manifest.version) continue;
    packages.set(`${manifest.name}@${manifest.version}`, manifest);
  }
  const report = {};
  for (const manifest of packages.values()) {
    const license = manifest.license ?? "NOASSERTION";
    report[license] ??= [];
    report[license].push({
      name: manifest.name,
      versions: [manifest.version],
      homepage: manifest.homepage,
    });
  }
  return report;
}

function generate(directory) {
  const packageMetadata = readPackageMetadata();
  findPackageTarball(directory, packageMetadata);
  const sbom = buildCycloneDx(runtimeLicenseReport(), packageMetadata);
  const sbomPath = join(
    directory,
    `${packageMetadata.name}-${packageMetadata.version}.cdx.json`,
  );
  writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  writeFileSync(
    join(directory, "SHA256SUMS"),
    createChecksums(directory),
    "utf8",
  );
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? "release");
  generate(directory);
  process.stdout.write(
    `Generated release metadata in ${basename(directory)}\n`,
  );
}
