import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(workspace, relativePath), "utf8");
}

describe("GitHub community files", () => {
  it("stores discoverable issue templates in the supported directory", () => {
    for (const file of [
      ".github/ISSUE_TEMPLATE/01-bug-report.zh-CN.md",
      ".github/ISSUE_TEMPLATE/02-bug-report.en-US.md",
    ]) {
      const template = read(file);
      expect(template).toMatch(/^---\nname: .+\nabout: .+\n/u);
    }

    expect(read(".github/ISSUE_TEMPLATE/config.yml")).toContain(
      "blank_issues_enabled: false",
    );
    expect(
      existsSync(resolve(workspace, ".github/ISSUE_TEMPLATE.zh-CN.md")),
    ).toBe(false);
    expect(
      existsSync(resolve(workspace, ".github/ISSUE_TEMPLATE.en-US.md")),
    ).toBe(false);
  });

  it("requires the evidence and safety attestations for an external trial", () => {
    const form = read(".github/ISSUE_TEMPLATE/03-external-trial.yml");
    for (const id of [
      "participant",
      "operating-system",
      "node-version",
      "reprocore-version",
      "install-result",
      "replay-result",
      "minimize-result",
      "export-confirmation",
      "safety-clarity",
      "report-quality",
      "first-blocker",
      "attestations",
    ]) {
      expect(form).toContain(`id: ${id}`);
    }
    expect(form.match(/required: true/gu)).toHaveLength(14);
    expect(form).toContain("我未参与 ReproCore 的实现");
    expect(form).toContain("reprocore redact --check");
  });

  it("provides a default bilingual pull request template", () => {
    const template = read(".github/PULL_REQUEST_TEMPLATE.md");
    expect(template).toContain("变更 / Change");
    expect(template).toContain("风险 / Risk");
    expect(template).toContain("验证 / Verification");
    expect(
      existsSync(resolve(workspace, ".github/PULL_REQUEST_TEMPLATE.zh-CN.md")),
    ).toBe(false);
    expect(
      existsSync(resolve(workspace, ".github/PULL_REQUEST_TEMPLATE.en-US.md")),
    ).toBe(false);
  });
});
