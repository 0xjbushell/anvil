import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import ejs from "ejs";
import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

import { getManifest, type Lang, type ManifestEntry, type ScaffoldContext } from "./manifest.ts";
import { previewScaffold, scaffold } from "./scaffold/engine.ts";

const languages: Lang[] = ["typescript", "golang", "python"];
const validSources = new Set(["static", "template", "generator"]);
const typescriptStaticRoot = new URL("../static/typescript/", import.meta.url);
const typescriptTemplateRoot = new URL("./templates/typescript/", import.meta.url);
const golangStaticRoot = new URL("../static/golang/", import.meta.url);
const golangTemplateRoot = new URL("./templates/golang/", import.meta.url);
const pythonStaticRoot = new URL("../static/python/", import.meta.url);
const pythonTemplateRoot = new URL("./templates/python/", import.meta.url);
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
const expectedGolangTemplateFiles = [
  ".golangci.yml.ejs",
  "go.mod.ejs",
  "Makefile.ejs",
  ".pre-commit-config.yaml.ejs",
  ".gitignore.ejs",
  "AGENTS.md.ejs",
  "README.md.ejs",
];
const expectedPythonStaticFiles = [
  "src/seed/__init__.py",
  "src/seed/seed.py",
  "src/seed/types.py",
  "src/seed/errors.py",
  "src/seed/constants.py",
  "src/seed/enums.py",
  "tests/conftest.py",
  "tests/test_seed.py",
  ".gitattributes",
  ".editorconfig",
  ".gitleaks.toml",
];
const expectedPythonTemplateFiles = [
  "pyproject.toml.ejs",
  ".flake8.ejs",
  "Makefile.ejs",
  ".pre-commit-config.yaml.ejs",
  ".gitignore.ejs",
  "AGENTS.md.ejs",
  "README.md.ejs",
];
const expectedRanges: Record<Lang, { min: number; max: number }> = {
  typescript: { min: 23, max: 30 },
  golang: { min: 19, max: 28 },
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

function golangStaticFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, golangStaticRoot));
}

function golangTemplateFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, golangTemplateRoot));
}

function pythonStaticFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, pythonStaticRoot));
}

function pythonTemplateFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, pythonTemplateRoot));
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

async function renderGolangTemplate(
  relativePath: string,
  overrides: Partial<ScaffoldContext> = {},
): Promise<string> {
  const template = await golangTemplateFile(relativePath).text();

  return ejs.render(template, makeContext("golang", overrides));
}

async function renderGolangRootTemplate(
  relativePath: string,
  overrides: Partial<ScaffoldContext> = {},
): Promise<string> {
  const rendered = await renderGolangTemplate(relativePath, {
    ...overrides,
    toolchain: { bun: "1.1.34", go: "1.99.0" },
  });

  expect(rendered).not.toContain("1.23");
  return rendered;
}

function makefileTargetRecipe(source: string, target: string): string {
  const match = source.match(new RegExp(`^${target}:[^\\n]*(?:\\n\\t[^\\n]*)*`, "m"));

  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

async function assertGofmtAccepts(source: string): Promise<void> {
  const targetDir = path.join(projectRoot, ".sandbox", `gofmt-template-${randomUUID()}`);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  try {
    await writeFile(path.join(targetDir, "main.go"), source, "utf8");
    const child = Bun.spawn(["gofmt", "-l", "main.go"], {
      cwd: targetDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
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
        "tools/go-analyzers/cmd/crap-report/**/*",
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

  test("Go manifest includes all TIX-000042 dynamic root template outputs", () => {
    const entries = new Map(getManifest("golang").entries.map((entry) => [entry.dest, entry]));

    for (const file of expectedGolangTemplateFiles) {
      const dest = file.slice(0, -".ejs".length);
      expect(entries.get(dest)).toMatchObject({
        dest,
        src: `src/templates/golang/${file}`,
        source: "template",
      });
    }
  });

  test("Python manifest includes all static seed and hygiene scaffold outputs", () => {
    const entries = new Map(getManifest("python").entries.map((entry) => [entry.dest, entry]));

    for (const file of expectedPythonStaticFiles) {
      expect(entries.get(file)).toMatchObject({
        dest: file,
        src: `static/python/${file}`,
        source: "static",
      });
    }
  });

  test("Python manifest includes all dynamic template scaffold outputs", () => {
    const entries = new Map(getManifest("python").entries.map((entry) => [entry.dest, entry]));

    for (const file of expectedPythonTemplateFiles) {
      const dest = file.slice(0, -".ejs".length);
      expect(entries.get(dest)).toMatchObject({
        dest,
        src: `src/templates/python/${file}`,
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

  test("Go static scaffold files for the seed and tool additions exist", async () => {
    const files = [
      "internal/seed/seed.go",
      "internal/seed/seed_test.go",
      "internal/seed/types.go",
      "internal/seed/errors.go",
      "internal/seed/constants.go",
      "internal/seed/enums.go",
      "tools/tools.go",
      "tools/go-analyzers/cmd/crap-report/main.go",
      "tools/go-analyzers/cmd/crap-report/main_test.go",
      ".editorconfig",
      ".gitleaks.toml",
      ".gitattributes",
    ];

    for (const file of files) {
      expect(await golangStaticFile(file).exists()).toBe(true);
    }
  });

  test("Python static scaffold files for the seed and hygiene additions exist", async () => {
    for (const file of expectedPythonStaticFiles) {
      expect(await pythonStaticFile(file).exists()).toBe(true);
    }
  });

  test("Python template scaffold files for dynamic config outputs exist", async () => {
    for (const file of expectedPythonTemplateFiles) {
      expect(await pythonTemplateFile(file).exists()).toBe(true);
    }
  });

  test("Go app entrypoint is rendered from a template source", async () => {
    const entry = getManifest("golang").entries.find((candidate) => candidate.dest === "cmd/app/main.go");

    expect(entry).toMatchObject({
      dest: "cmd/app/main.go",
      src: "src/templates/golang/cmd/app/main.go.ejs",
      source: "template",
    });
    expect(await golangTemplateFile("cmd/app/main.go.ejs").exists()).toBe(true);
  });

  test("Go dynamic root template files exist at their manifest source paths", async () => {
    for (const file of expectedGolangTemplateFiles) {
      expect(await golangTemplateFile(file).exists()).toBe(true);
    }
  });

  test("Go golangci template renders the required CONFIG-02 linter set", async () => {
    const rendered = await renderGolangRootTemplate(".golangci.yml.ejs");
    const requiredLinters = [
      "errcheck",
      "err113",
      "gocognit",
      "exhaustive",
      "gosec",
      "govet",
      "unused",
      "gochecknoinits",
      "gochecknoglobals",
      "revive",
      "staticcheck",
      "funlen",
    ];
    const config = parseYaml(rendered) as {
      linters?: { enable?: string[]; settings?: { funlen?: { lines?: number; statements?: unknown } } };
      "linters-settings"?: { funlen?: { lines?: number; statements?: unknown } };
    };
    const enabledLinters = config.linters?.enable ?? [];
    const funlen = config["linters-settings"]?.funlen ?? config.linters?.settings?.funlen;

    expect(enabledLinters).toEqual(expect.arrayContaining(requiredLinters));
    expect(funlen?.lines).toBe(80);
    expect(funlen).not.toHaveProperty("statements");
  });

  test("Go module template renders the project module and resolved Go toolchain", async () => {
    const rendered = await renderGolangRootTemplate("go.mod.ejs", {
      projectName: "github.com/acme/my-service",
    });

    expect(rendered).toContain("module github.com/acme/my-service");
    expect(rendered).toMatch(/^go 1\.99\.0$/m);
  });

  test("Go root Makefile template renders the required quality targets and commands", async () => {
    const rendered = await renderGolangRootTemplate("Makefile.ejs");
    const targets = [
      "lint",
      "format",
      "typecheck",
      "security",
      "test",
      "coverage",
      "deadcode",
      "crap",
      "audit",
      "mutate",
      "quality",
      "check",
      "fix",
    ];

    for (const target of targets) {
      expect(rendered).toMatch(new RegExp(`^${target}:`, "m"));
    }

    const lintRecipe = makefileTargetRecipe(rendered, "lint");
    const typecheckRecipe = makefileTargetRecipe(rendered, "typecheck");

    expect(rendered).toMatch(/^tools\/go-analyzers\/bin\/anvil-lint:\n\t(?:\$\(MAKE\)|make) -C tools\/go-analyzers build$/m);
    expect(lintRecipe).toContain("go vet -vettool=tools/go-analyzers/bin/anvil-lint ./...");
    expect(typecheckRecipe).toContain("go vet ./...");
    expect(typecheckRecipe).toContain("staticcheck ./...");
  });

  test("Go pre-commit template wires tier-1 hooks to pre-commit and check to pre-push", async () => {
    const rendered = await renderGolangRootTemplate(".pre-commit-config.yaml.ejs");
    const config = parseYaml(rendered) as {
      default_install_hook_types?: string[];
      repos?: Array<{ hooks?: Array<{ id?: string; stages?: string[] }> }>;
    };
    const hooks = new Map(
      (config.repos ?? [])
        .flatMap((repo) => repo.hooks ?? [])
        .filter((hook): hook is { id: string; stages?: string[] } => typeof hook.id === "string")
        .map((hook) => [hook.id, hook]),
    );

    expect(config.default_install_hook_types).toEqual(["pre-commit", "pre-push"]);
    for (const hook of ["lint", "format", "typecheck", "gitleaks"]) {
      expect(hooks.get(hook)?.stages).toContain("pre-commit");
    }
    expect(hooks.get("check")?.stages).toContain("pre-push");
  });

  test("Go AGENTS template is concise, project-specific, and non-disposable", async () => {
    const rendered = await renderGolangRootTemplate("AGENTS.md.ejs");

    expect(rendered.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    expect(rendered).toContain("internal/seed/");
    for (const section of ["Validation", "Code Conventions", "Testing"]) {
      expect(rendered).toMatch(new RegExp(`^## ${section}$`, "m"));
    }
    expect(rendered).not.toMatch(/\b(disposable|starter)\b/i);
  });

  test("Go README template renders the project name and resolved Go version", async () => {
    const rendered = await renderGolangRootTemplate("README.md.ejs", {
      projectName: "my-service",
    });

    expect(rendered).toContain("my-service");
    expect(rendered).toContain("Go 1.99.0+");
    expect(rendered).not.toContain("Go 1.23");
  });

  test("Go gitignore template covers analyzer, test, build, IDE, and OS artifacts", async () => {
    const rendered = await renderGolangRootTemplate(".gitignore.ejs");

    for (const ignored of [
      "tools/go-analyzers/bin/",
      "coverage.out",
      "*.test",
      "bin/",
      "dist/",
      ".idea/",
      ".vscode/",
      ".DS_Store",
    ]) {
      expect(rendered).toContain(ignored);
    }
  });

  test("Go app entrypoint template renders a valid import path for scoped project names", async () => {
    const rendered = await renderGolangTemplate("cmd/app/main.go.ejs", {
      projectName: "@scope/app",
    });

    expect(rendered).toContain('"scope/app/internal/seed"');
    expect(rendered).not.toContain('"@scope/app/internal/seed"');
  });

  test("Go app entrypoint template renders gofmt-canonical source", async () => {
    const rendered = await renderGolangTemplate("cmd/app/main.go.ejs", {
      projectName: "example.com/service",
    });

    await assertGofmtAccepts(rendered);
  });

  test("Go static manifest source paths exist", async () => {
    for (const entry of getManifest("golang").entries.filter((candidate) => candidate.source === "static")) {
      expect(await sourcePathExists(entry.src)).toBe(true);
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

  test("Go analyzer manifest includes CRAP report at the spec path", () => {
    const dests = getManifest("golang").entries.map((entry) => entry.dest);

    expect(dests).toContain("tools/go-analyzers/cmd/crap-report/**/*");
    expect(dests).not.toContain("tools/crap-score.go");
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
