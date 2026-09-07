import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspace = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(workspace, relativePath), "utf8");
}

const bilingualDocuments = [
  ["installation", "Installation and upgrades"],
  ["cli", "CLI reference"],
  ["architecture", "Architecture"],
  ["security", "Security model"],
  ["mincase-format", "`.mincase` format"],
] as const;

describe("bilingual project documentation", () => {
  it.each(bilingualDocuments)(
    "provides a complete English %s document with a Chinese backlink",
    (document, heading) => {
      const english = read(`docs/${document}.en.md`);
      const chinese = read(`docs/${document}.md`);
      expect(english).toContain(`# ${heading}`);
      expect(english).toContain(`中文：[`);
      expect(english.split("\n").filter(Boolean).length).toBeGreaterThan(20);
      expect(chinese).toContain(`English: [`);
      expect(chinese).toContain(`(${document}.en.md)`);
    },
  );

  it("routes English README readers to the full English references", () => {
    const readme = read("README.en.md");
    for (const [document] of bilingualDocuments) {
      expect(readme).toContain(`docs/${document}.en.md`);
    }
  });
});
