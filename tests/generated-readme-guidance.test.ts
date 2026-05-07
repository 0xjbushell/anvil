import path from "node:path";

import ejs from "ejs";
import { describe, expect, test } from "bun:test";

import { scaffoldAssets } from "../src/generated/scaffold-assets.ts";
import type { ScaffoldContext } from "../src/types.ts";

const projectRoot = path.resolve(import.meta.dir, "..");
const disposableSignals = /\b(delete|remove|disposable|throwaway|temporary|starter|placeholder|stub)\b/i;
type ReadmeLanguage = "typescript" | "golang" | "python";

function makeContext(lang: ScaffoldContext["lang"], overrides: Partial<ScaffoldContext> = {}): ScaffoldContext {
  return {
    projectName: "example-service",
    lang,
    targetDir: "/tmp/example-service",
    hasExistingCode: false,
    skipSeed: false,
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "1.3.13", node: "24.0.0", go: "1.25.0", python: "3.13.0" },
    anvilVersion: "0.2.0",
    year: 2026,
    ...overrides,
  };
}

async function renderTemplate(template: string, lang: ReadmeLanguage, overrides: Partial<ScaffoldContext> = {}) {
  return ejs.render(template, makeContext(lang, overrides));
}

async function readSourceTemplate(lang: ReadmeLanguage, templateName: string) {
  const templatePath = path.join(projectRoot, "src", "templates", lang, templateName);

  return Bun.file(templatePath).text();
}

function readEmbeddedTemplate(lang: ReadmeLanguage, templateName: string): string {
  const assetPath = `src/templates/${lang}/${templateName}`;
  const template = scaffoldAssets[assetPath];

  expect(template, `missing embedded asset ${assetPath}`).toBeDefined();
  return template ?? "";
}

async function renderEmbeddedReadme(lang: ReadmeLanguage, overrides: Partial<ScaffoldContext> = {}) {
  return renderTemplate(readEmbeddedTemplate(lang, "README.md.ejs"), lang, overrides);
}

async function makeTargets(lang: ReadmeLanguage): Promise<string[]> {
  const makefile = await readSourceTemplate(lang, "Makefile.ejs");
  const match = makefile.match(/^\.PHONY:\s+(.+)$/m);

  expect(match, `${lang} Makefile must declare .PHONY targets`).not.toBeNull();
  return match?.[1]?.trim().split(/\s+/) ?? [];
}

async function expectReadmeMatchesMakefileTargets(lang: ReadmeLanguage, readme: string): Promise<void> {
  for (const target of await makeTargets(lang)) {
    expect(readme).toContain(`make ${target}`);
  }
}

async function expectSourceAndEmbeddedReadmes(
  lang: ReadmeLanguage,
  assertReadme: (readme: string) => Promise<void> | void,
  overrides: Partial<ScaffoldContext> = {},
): Promise<void> {
  const templatePath = path.join(projectRoot, "src", "templates", lang, "README.md.ejs");
  const template = await Bun.file(templatePath).text();
  const readmes = [
    await renderTemplate(template, lang, overrides),
    await renderEmbeddedReadme(lang, overrides),
  ];

  for (const readme of readmes) {
    expectCommonGuidance(readme);
    await expectReadmeMatchesMakefileTargets(lang, readme);
    await assertReadme(readme);
  }
}

function expectCommonGuidance(readme: string): void {
  expect(readme).toContain("Anvil-generated validation gates");
  expect(readme).toContain("seed/reference code");
  expect(readme).toContain("conventions to follow");
  expect(readme).toContain("`AGENTS.md`");
  expect(readme).toContain("`.anvil.lock`");
  expect(readme).not.toMatch(disposableSignals);
}

describe("TIX-000096 generated README guidance", () => {
  test("TypeScript README explains gates, provenance, agents, and first commands", async () => {
    await expectSourceAndEmbeddedReadmes(
      "typescript",
      (readme) => {
        expect(readme).toContain("bun install");
        expect(readme).toContain("pre-commit install");
        expect(readme).toContain("src/seed/");
        expect(readme).toContain("tools/lint-rules/");
        expect(readme).toContain("tools/crap-score.ts");
      },
      {
        packageManager: "bun",
        sourceDir: "src",
        toolchain: { bun: "1.3.13", node: "24.0.0" },
      },
    );
  });

  test("Go README explains gates, provenance, agents, and Go-specific paths", async () => {
    await expectSourceAndEmbeddedReadmes(
      "golang",
      (readme) => {
        expect(readme).toContain("go mod tidy");
        expect(readme).toContain("internal/seed/");
        expect(readme).toContain("tools/go-analyzers/");
        expect(readme).toContain("golangci-lint");
        expect(readme).toContain("govulncheck");
      },
      {
        toolchain: { bun: "1.3.13", go: "1.25.0" },
      },
    );
  });

  test("Python README explains gates, provenance, agents, and Python-specific paths", async () => {
    await expectSourceAndEmbeddedReadmes(
      "python",
      (readme) => {
        expect(readme).toContain("uv venv");
        expect(readme).toContain("uv pip install -e \".[dev]\"");
        expect(readme).toContain("src/seed/");
        expect(readme).toContain("tools/flake8-plugin/");
        expect(readme).toContain("Ruff");
        expect(readme).toContain("mypy");
      },
      {
        toolchain: { bun: "1.3.13", python: "3.13.0" },
      },
    );
  });
});
