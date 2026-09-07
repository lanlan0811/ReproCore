import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readGiteeConfiguration(environment) {
  const names = [
    "GITEE_ACCESS_TOKEN",
    "GITEE_OWNER",
    "GITEE_REPO",
    "GIT_TAG",
    "RELEASE_DIRECTORY",
  ];
  const missing = names.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing Gitee release configuration: ${missing.join(", ")}`,
    );
  }
  return Object.fromEntries(
    names.map((name) => [name, environment[name].trim()]),
  );
}

async function requestJson(fetchImplementation, url, options) {
  const response = await fetchImplementation(url, options);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Gitee API ${response.status}: ${detail}`);
  }
  return response.json();
}

async function requestBytes(fetchImplementation, url, options) {
  const response = await fetchImplementation(url, options);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Gitee API ${response.status}: ${detail}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function requestWithoutBody(fetchImplementation, url, options) {
  const response = await fetchImplementation(url, options);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Gitee API ${response.status}: ${detail}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function findRelease(fetchImplementation, url, headers) {
  const response = await fetchImplementation(url, { headers });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1_000);
    throw new Error(`Gitee API ${response.status}: ${detail}`);
  }
  return response.json();
}

export async function publishGiteeRelease(
  configuration,
  fetchImplementation = globalThis.fetch,
) {
  const {
    GITEE_ACCESS_TOKEN: token,
    GITEE_OWNER: owner,
    GITEE_REPO: repository,
    GIT_TAG: tag,
    RELEASE_DIRECTORY: releaseDirectory,
  } = configuration;
  const baseUrl = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const existingRelease = await findRelease(
    fetchImplementation,
    `${baseUrl}/releases/tags/${encodeURIComponent(tag)}`,
    headers,
  );
  const release =
    existingRelease ??
    (await requestJson(fetchImplementation, `${baseUrl}/releases`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: configuration.GITEE_TARGET_COMMITISH ?? tag,
        name: `ReproCore ${tag}`,
        body: `ReproCore ${tag} release. The attached files are identical to the GitHub Release assets.`,
        prerelease: false,
      }),
    }));
  const existingAssets = existingRelease
    ? await requestJson(
        fetchImplementation,
        `${baseUrl}/releases/${encodeURIComponent(String(release.id))}/attach_files?per_page=100`,
        { headers },
      )
    : [];
  const existingByName = new Map(
    existingAssets.map((asset) => [asset.name ?? asset.filename, asset]),
  );

  const directory = resolve(releaseDirectory);
  const assets = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(directory, entry.name))
    .sort();
  if (assets.length === 0) throw new Error("No Gitee release assets found");

  for (const asset of assets) {
    const name = basename(asset);
    const content = readFileSync(asset);
    const existing = existingByName.get(name);
    if (existing !== undefined) {
      if (existing.id === undefined) {
        throw new Error(`Gitee release asset is missing its ID: ${name}`);
      }
      const attachmentUrl = `${baseUrl}/releases/${encodeURIComponent(String(release.id))}/attach_files/${encodeURIComponent(String(existing.id))}`;
      const downloaded = await requestBytes(
        fetchImplementation,
        `${attachmentUrl}/download`,
        { headers: { ...headers, Accept: "application/octet-stream" } },
      );
      if (sha256(downloaded) === sha256(content)) continue;
      await requestWithoutBody(fetchImplementation, attachmentUrl, {
        method: "DELETE",
        headers,
      });
    }
    const form = new globalThis.FormData();
    form.append("file", new globalThis.Blob([content]), name);
    await requestJson(
      fetchImplementation,
      `${baseUrl}/releases/${encodeURIComponent(String(release.id))}/attach_files`,
      { method: "POST", headers, body: form },
    );
  }
  return { id: release.id, assets: assets.map((asset) => basename(asset)) };
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await publishGiteeRelease(readGiteeConfiguration(process.env));
  process.stdout.write(
    `Published ${result.assets.length} assets to Gitee release ${result.id}\n`,
  );
}
