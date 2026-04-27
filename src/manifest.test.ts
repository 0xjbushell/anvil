import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import ejs from "ejs";
import { describe, expect, test } from "bun:test";

import { getManifest, type Lang, type ManifestEntry, type ScaffoldContext } from "./manifest.ts";
import { previewScaffold, scaffold } from "./scaffold/engine.ts";

const languages: Lang[] = ["typescript", "golang", "python"];
const validSources = new Set(["static", "template", "generator"]);
const typescriptStaticRoot = new URL("../static/typescript/", import.meta.url);
const typescriptTemplateRoot = new URL("./templates/typescript/", import.meta.url);
const projectRoot = path.resolve(import.meta.dir, "..");
const expectedTypescriptStaticFiles = [
  "src/seed/seed.ts",
  "src/seed/seed.test.ts",
  "src/seed/types.ts",
  "src/seed/errors.ts",
  "src/seed/constants.ts",
  "src/seed/enums.ts",
  "tools/crap-score.ts",
  "knip.json",
  "stryker.config.mjs",
  ".gitattributes",
  ".editorconfig",
  ".gitleaks.toml",
];
const expectedTypescriptTemplateFiles = [
  "eslint.config.mjs.ejs",
  "tsconfig.json.ejs",
  ".prettierrc.ejs",
  "package.json.ejs",
  "vitest.config.ts.ejs",
  "Makefile.ejs",
  ".pre-commit-config.yaml.ejs",
  ".gitignore.ejs",
  "AGENTS.md.ejs",
  "README.md.ejs",
];
const expectedRanges: Record<Lang, { min: number; max: number }> = {
  typescript: { min: 23, max: 30 },
  golang: { min: 18, max: 27 },
  python: { min: 18, max: 24 },
};
const expectedSeedDests: Record<Lang, string[]> = {
  typescript: [
    "src/seed/constants.ts",
    "src/seed/enums.ts",
    "src/seed/errors.ts",
    "src/seed/seed.test.ts",
    "src/seed/seed.ts",
    "src/seed/types.ts",
  ],
  golang: [
    "cmd/app/main.go",
    "internal/seed/constants.go",
    "internal/seed/enums.go",
    "internal/seed/errors.go",
    "internal/seed/seed.go",
    "internal/seed/seed_test.go",
    "internal/seed/types.go",
  ],
  python: [
    "src/seed/__init__.py",
    "src/seed/constants.py",
    "src/seed/enums.py",
    "src/seed/errors.py",
    "src/seed/seed.py",
    "src/seed/types.py",
    "tests/conftest.py",
    "tests/test_seed.py",
  ],
};

function makeContext(
  lang: Lang,
  overrides: Partial<ScaffoldContext> = {},
): ScaffoldContext {
  return {
    projectName: "example",
    lang,
    targetDir: "/tmp/example",
    hasExistingCode: false,
    skipSeed: false,
    packageManager: lang === "typescript" ? "bun" : undefined,
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "1.1.34" },
    anvilVersion: "0.1.0",
    ...overrides,
  };
}

function seedEntries(lang: Lang): ManifestEntry[] {
  const { entries } = getManifest(lang);

  if (lang === "golang") {
    return entries.filter(
      (entry) => entry.dest.startsWith("internal/seed/") || entry.dest === "cmd/app/main.go",
    );
  }

  if (lang === "python") {
    return entries.filter(
      (entry) =>
        entry.dest.startsWith("src/seed/") ||
        entry.dest === "tests/conftest.py" ||
        entry.dest === "tests/test_seed.py",
    );
  }

  return entries.filter((entry) => entry.dest.startsWith("src/seed/"));
}

function typescriptStaticFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, typescriptStaticRoot));
}

function typescriptTemplateFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, typescriptTemplateRoot));
}

async function sourcePathExists(sourcePath: string): Promise<boolean> {
  const sourceBase = sourcePath.endsWith("/**/*")
    ? sourcePath.slice(0, -"/**/*".length)
    : sourcePath;

  try {
    await stat(path.join(projectRoot, sourceBase));
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function renderTypescriptTemplate(
  relativePath: string,
  overrides: Partial<ScaffoldContext> = {},
): Promise<string> {
  const template = await typescriptTemplateFile(relativePath).text();

  return ejs.render(template, makeContext("typescript", overrides));
}

describe("scaffold manifests", () => {
  test("each supported language returns a non-empty manifest", () => {
    for (const lang of languages) {
      const manifest = getManifest(lang);

      expect(manifest.lang).toBe(lang);
      expect(manifest.entries.length).toBeGreaterThan(0);
    }
  });

  test("entry counts stay in the expected output-map ranges", () => {
    for (const lang of languages) {
      const { entries } = getManifest(lang);
      const range = expectedRanges[lang];

      expect(entries.length).toBeGreaterThanOrEqual(range.min);
      expect(entries.length).toBeLessThanOrEqual(range.max);
    }
  });

  test("every entry has required fields and a valid source", () => {
    for (const lang of languages) {
      for (const entry of getManifest(lang).entries) {
        expect(entry.dest).toBeTruthy();
        expect(entry.src).toBeTruthy();
        expect(validSources.has(entry.source)).toBe(true);
      }
    }
  });

  test("static and template sources point under their expected roots", () => {
    for (const lang of languages) {
      for (const entry of getManifest(lang).entries) {
        if (entry.source === "static") {
          expect(entry.src.startsWith(`static/${lang}/`)).toBe(true);
        }

        if (entry.source === "template") {
          expect(
            entry.src.startsWith("src/templates/") || entry.src.startsWith(`static/${lang}/`),
          ).toBe(true);
          expect(entry.src.endsWith(".ejs")).toBe(true);
        }
      }
    }
  });

  test("generator entries use stable generator ids when present", () => {
    const generatorEntries = languages.flatMap((lang) =>
      getManifest(lang).entries.filter((entry) => entry.source === "generator"),
    );

    for (const entry of generatorEntries) {
      expect(entry.src).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
    }
  });

  test("TypeScript manifest uses only executable scaffold sources", () => {
    const generatorEntries = getManifest("typescript").entries.filter(
      (entry) => entry.source === "generator",
    );

    expect(generatorEntries).toEqual([]);
  });

  test("seed conditions account for existing code and explicit seed skips", () => {
    for (const lang of languages) {
      for (const entry of seedEntries(lang)) {
        expect(entry.when).toBeDefined();
        expect(entry.when?.(makeContext(lang, { hasExistingCode: true, skipSeed: true }))).toBe(
          false,
        );
        expect(entry.when?.(makeContext(lang, { hasExistingCode: false, skipSeed: true }))).toBe(
          false,
        );
        expect(entry.when?.(makeContext(lang, { hasExistingCode: true, skipSeed: false }))).toBe(
          false,
        );
        expect(entry.when?.(makeContext(lang, { hasExistingCode: false, skipSeed: false }))).toBe(
          true,
        );
      }
    }
  });

  test("non-seed entries are unconditional", () => {
    for (const lang of languages) {
      const seeds = new Set(seedEntries(lang).map((entry) => entry.dest));
      const nonSeedEntries = getManifest(lang).entries.filter((entry) => !seeds.has(entry.dest));

      expect(nonSeedEntries.length).toBeGreaterThan(0);
      for (const entry of nonSeedEntries) {
        expect(entry.when).toBeUndefined();
      }
    }
  });

  test("seed paths are correct for each language", () => {
    for (const lang of languages) {
      const seedDests = seedEntries(lang).map((entry) => entry.dest).sort();

      expect(seedDests).toEqual(expectedSeedDests[lang]);
    }
  });

  test("directory tree entries use explicit glob-like paths for downstream expansion", () => {
    const expectedGlobDests: Record<Lang, string[]> = {
      typescript: [
        "tools/lint-rules/anti-slop/**/*",
        "tools/lint-rules/error-handling/**/*",
        "tools/lint-rules/structural/**/*",
        "tools/lint-rules/test-quality/**/*",
      ],
      golang: [
        "tools/go-analyzers/anti_slop/**/*",
        "tools/go-analyzers/cmd/anvil-lint/**/*",
        "tools/go-analyzers/structural/**/*",
        "tools/go-analyzers/test_quality/**/*",
        "tools/go-analyzers/testdata/**/*",
      ],
      python: ["tools/flake8-plugin/anvil_lint/**/*"],
    };

    for (const lang of languages) {
      const dests = new Set(getManifest(lang).entries.map((entry) => entry.dest));

      for (const dest of expectedGlobDests[lang]) {
        expect(dests.has(dest)).toBe(true);
      }
    }
  });

  test("TypeScript manifest includes lint-rule CommonJS package boundary", () => {
    const dests = getManifest("typescript").entries.map((entry) => entry.dest);

    expect(dests).toContain("tools/lint-rules/package.json");
  });

  test("TypeScript manifest includes all static scaffold outputs", () => {
    const entries = new Map(getManifest("typescript").entries.map((entry) => [entry.dest, entry]));

    for (const file of expectedTypescriptStaticFiles) {
      expect(entries.get(file)).toMatchObject({
        dest: file,
        src: `static/typescript/${file}`,
        source: "static",
      });
    }
  });

  test("TypeScript manifest includes all dynamic template outputs", () => {
    const entries = new Map(getManifest("typescript").entries.map((entry) => [entry.dest, entry]));

    for (const file of expectedTypescriptTemplateFiles) {
      const dest = file.slice(0, -".ejs".length);
      expect(entries.get(dest)).toMatchObject({
        dest,
        src: `src/templates/typescript/${file}`,
        source: "template",
      });
    }
  });

  test("TypeScript static scaffold files exist", async () => {
    for (const file of expectedTypescriptStaticFiles) {
      expect(await typescriptStaticFile(file).exists()).toBe(true);
    }
  });

  test("TypeScript template scaffold files exist", async () => {
    for (const file of expectedTypescriptTemplateFiles) {
      expect(await typescriptTemplateFile(file).exists()).toBe(true);
    }
  });

  test("TypeScript manifest source paths exist", async () => {
    for (const entry of getManifest("typescript").entries) {
      expect(await sourcePathExists(entry.src)).toBe(true);
    }
  });

  test("TypeScript package and Makefile templates render Bun audit support", async () => {
    const packageJson = JSON.parse(await renderTypescriptTemplate("package.json.ejs")) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const makefile = await renderTypescriptTemplate("Makefile.ejs");

    expect(packageJson.name).toBe("example");
    expect(packageJson.dependencies.pino).toBeDefined();
    expect(packageJson.devDependencies["better-npm-audit"]).toBeDefined();
    expect(packageJson.devDependencies["@stryker-mutator/core"]).toBeDefined();
    expect(packageJson.devDependencies["@stryker-mutator/vitest-runner"]).toBeDefined();
    expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBeDefined();
    expect(packageJson.scripts.crap).toContain("tools/crap-score.ts");
    expect(makefile).toContain("PKG_EXEC ?= bunx");
    expect(makefile).toContain("lint: ## Run all linters (built-in + custom)\n\t$(PKG_EXEC) eslint .");
    expect(makefile).toContain("$(PKG_EXEC) better-npm-audit audit");
    expect(makefile).not.toContain("bun audit");
  });

  test("TypeScript templates route non-Bun package manager commands", async () => {
    const packageJson = JSON.parse(
      await renderTypescriptTemplate("package.json.ejs", { packageManager: "npm" }),
    ) as { devDependencies: Record<string, string> };
    const makefile = await renderTypescriptTemplate("Makefile.ejs", { packageManager: "npm" });

    expect(packageJson.devDependencies["better-npm-audit"]).toBeUndefined();
    expect(makefile).toContain("PKG_EXEC ?= npx");
    expect(makefile).toContain("npm audit");
    expect(makefile).not.toContain("bun audit");
  });

  test("TypeScript config templates render valid configs and compact agent guidance", async () => {
    const tsconfig = JSON.parse(await renderTypescriptTemplate("tsconfig.json.ejs"));
    const prettierrc = JSON.parse(await renderTypescriptTemplate(".prettierrc.ejs"));
    const agents = await renderTypescriptTemplate("AGENTS.md.ejs");

    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(prettierrc).toMatchObject({ semi: true, singleQuote: false });
    expect(agents.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    expect(agents).toContain("src/seed/");
    expect(agents).not.toMatch(/\b(disposable|temporary|throwaway)\b/i);
  });

  test("real TypeScript manifest previews and scaffolds executable entries", async () => {
    const targetDir = path.join(projectRoot, ".sandbox", `manifest-smoke-${randomUUID()}`);
    const ctx = makeContext("typescript", {
      targetDir,
      nonInteractive: true,
      toolchain: { bun: "1.1.34", node: "22.11.0" },
    });

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });

    try {
      const preview = await previewScaffold(ctx);
      expect(preview.changes.map((change) => change.path)).toContain("package.json");
      expect(preview.changes.every((change) => change.action === "create")).toBe(true);
      expect(await Bun.file(path.join(targetDir, "package.json")).exists()).toBe(false);

      const result = await scaffold(ctx, {
        onReport: async () => {
          throw new Error("empty TypeScript smoke target should not report conflicts");
        },
      });
      const renderedPackage = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));

      expect(result.filesCreated).toContain("package.json");
      expect(renderedPackage.name).toBe("example");
      expect(renderedPackage.dependencies.pino).toBeDefined();
      expect(renderedPackage.devDependencies["better-npm-audit"]).toBeDefined();
      expect(await Bun.file(path.join(targetDir, ".anvil.lock")).exists()).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });

  test("TypeScript seed files stay within size limits and avoid disposability markers", async () => {
    const seedFiles = expectedTypescriptStaticFiles.filter((file) => file.startsWith("src/seed/"));
    const disposableSignals = /\b(TODO|FIXME|temporary|placeholder|implement later|stub)\b/i;

    for (const file of seedFiles) {
      const text = await typescriptStaticFile(file).text();
      const lines = text.trimEnd().split("\n");

      expect(lines.length).toBeLessThanOrEqual(100);
      expect(text).not.toMatch(disposableSignals);
    }
  });

  test("TypeScript seed module demonstrates required conventions", async () => {
    const seed = await typescriptStaticFile("src/seed/seed.ts").text();
    const seedTest = await typescriptStaticFile("src/seed/seed.test.ts").text();

    expect(seed).toContain('from "pino"');
    expect(seed).toContain("logger.info({");
    expect(seed).not.toContain("console.");
    expect(seed).toContain("throw new GreetingError");
    expect(seedTest).toContain("toThrow(GreetingError)");
    expect(seedTest).not.toContain(".skip(");
    expect(seedTest).not.toContain("toMatchSnapshot");
  });

  test("TypeScript static quality configs are valid", async () => {
    expect(JSON.parse(await typescriptStaticFile("knip.json").text())).toMatchObject({
      entry: expect.any(Array),
      project: expect.any(Array),
    });

    expect(await typescriptStaticFile("stryker.config.mjs").text()).toContain(
      'testRunner: "vitest"',
    );
    expect(await typescriptStaticFile(".editorconfig").text()).toContain("end_of_line = lf");
    expect(await typescriptStaticFile(".gitleaks.toml").text()).toContain("[allowlist]");
    expect(await typescriptStaticFile(".gitattributes").text()).toContain("* text=auto eol=lf");
  });

  test("Go analyzer manifest defers CRAP report until its scaffold exists", () => {
    const dests = getManifest("golang").entries.map((entry) => entry.dest);

    expect(dests).not.toContain("tools/go-analyzers/cmd/crap-report/**/*");
  });

  test("invalid languages throw", () => {
    const unsupportedLang = "rust" as unknown as Lang;

    expect(() => getManifest(unsupportedLang)).toThrow("Unsupported language");
  });

  test("destinations are unique within each language", () => {
    for (const lang of languages) {
      const dests = getManifest(lang).entries.map((entry) => entry.dest);

      expect(new Set(dests).size).toBe(dests.length);
    }
  });

  test("no manifest entry references the lockfile", () => {
    for (const lang of languages) {
      for (const entry of getManifest(lang).entries) {
        expect(entry.dest).not.toContain(".anvil.lock");
        expect(entry.src).not.toContain(".anvil.lock");
      }
    }
  });

  test("template and static root skeletons exist", async () => {
    const paths = [
      new URL("./templates/.gitkeep", import.meta.url),
      new URL("../static/typescript/.gitkeep", import.meta.url),
      new URL("../static/golang/.gitkeep", import.meta.url),
      new URL("../static/python/.gitkeep", import.meta.url),
    ];

    for (const path of paths) {
      expect(await Bun.file(path).exists()).toBe(true);
    }
  });
});
