import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import ejs from "ejs";
import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

import { getManifest, type ScaffoldContext } from "../manifest.ts";
import { previewScaffold, scaffold } from "./engine.ts";

const projectRoot = path.resolve(import.meta.dir, "../..");
const pythonTemplateRoot = new URL("../../src/templates/python/", import.meta.url);
const requiredTargets = [
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
const ruffRuleSets = ["E", "W", "F", "I", "N", "UP", "BLE", "S", "C90", "SIM", "PIE", "PT", "PTH", "RUF", "D"];
const devDependencies = ["ruff", "flake8", "mypy", "pytest", "pytest-cov", "vulture", "mutmut", "pytest-crap", "pip-audit"];

function makeContext(overrides: Partial<ScaffoldContext> = {}): ScaffoldContext {
  return {
    projectName: "example-service",
    lang: "python",
    targetDir: "/tmp/example-service",
    hasExistingCode: false,
    skipSeed: false,
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "1.1.34", python: "3.13.1" },
    anvilVersion: "0.1.0",
    ...overrides,
  };
}

async function renderPythonTemplate(
  relativePath: string,
  overrides: Partial<ScaffoldContext> = {},
): Promise<string> {
  const template = await Bun.file(new URL(relativePath, pythonTemplateRoot)).text();

  return ejs.render(template, makeContext(overrides));
}

function makefileTargetRecipe(source: string, target: string): string {
  const match = source.match(new RegExp(`^${target}:[^\\n]*(?:\\n\\t[^\\n]*)*`, "m"));

  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

function makefileTargetLine(source: string, target: string): string {
  const match = source.match(new RegExp(`^${target}:[^\\n]*`, "m"));

  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

describe("Python dynamic scaffold templates", () => {
  test("manifest maps current Python dynamic outputs to templates", () => {
    const templateEntries = getManifest("python").entries.filter((entry) => entry.source === "template");

    expect(templateEntries.map((entry) => entry.dest).sort()).toEqual([
      ".flake8",
      ".gitignore",
      ".pre-commit-config.yaml",
      "AGENTS.md",
      "Makefile",
      "README.md",
      "pyproject.toml",
    ]);
    for (const entry of templateEntries) {
      expect(entry.src).toBe(`src/templates/python/${entry.dest}.ejs`);
    }
  });

  test("pyproject template renders valid Ruff, mypy, pytest, coverage, and dev dependency config", async () => {
    const rendered = await renderPythonTemplate("pyproject.toml.ejs");
    const pyproject = Bun.TOML.parse(rendered) as {
      project?: { name?: string; "optional-dependencies"?: { dev?: string[] } };
      tool?: {
        coverage?: { report?: { fail_under?: number }; run?: { branch?: boolean; source?: string[] } };
        mypy?: { python_version?: string; strict?: boolean; warn_return_any?: boolean; warn_unused_configs?: boolean };
        pytest?: { ini_options?: { addopts?: string; pythonpath?: string[]; testpaths?: string[] } };
        ruff?: {
          exclude?: string[];
          lint?: { select?: string[]; mccabe?: { "max-complexity"?: number }; pydocstyle?: { convention?: string } };
        };
      };
    };

    expect(pyproject.project?.name).toBe("example-service");
    for (const dependency of devDependencies) {
      expect(pyproject.project?.["optional-dependencies"]?.dev?.some((entry) => entry.startsWith(`${dependency}>`))).toBe(true);
    }
    expect(pyproject.tool?.ruff?.lint?.select).toEqual(expect.arrayContaining(ruffRuleSets));
    expect(pyproject.tool?.ruff?.exclude).toEqual(["tools/flake8-plugin"]);
    expect(pyproject.tool?.ruff?.lint?.mccabe?.["max-complexity"]).toBe(10);
    expect(pyproject.tool?.ruff?.lint?.pydocstyle?.convention).toBe("numpy");
    expect(pyproject.tool?.mypy).toMatchObject({
      disallow_untyped_defs: true,
      python_version: "3.11",
      strict: true,
      warn_return_any: true,
      warn_unused_configs: true,
    });
    expect(pyproject.tool?.pytest?.ini_options).toMatchObject({
      addopts: "--strict-markers -v",
      pythonpath: ["src"],
      testpaths: ["tests"],
    });
    expect(pyproject.tool?.coverage?.run).toMatchObject({ branch: true, source: ["src"] });
    expect(pyproject.tool?.coverage?.report?.fail_under).toBe(80);
  });

  test("Makefile template renders Python quality targets with uv commands", async () => {
    const rendered = await renderPythonTemplate("Makefile.ejs");

    for (const target of requiredTargets) {
      expect(rendered).toMatch(new RegExp(`^${target}:`, "m"));
    }

    expect(makefileTargetRecipe(rendered, "lint")).toContain("uv pip install -e tools/flake8-plugin/ --quiet");
    expect(makefileTargetRecipe(rendered, "lint")).toContain("uv run ruff check .");
    expect(makefileTargetRecipe(rendered, "lint")).toContain("uv run flake8 --select=ANV src tests");
    expect(makefileTargetRecipe(rendered, "format")).toContain("uv run ruff format --check .");
    expect(makefileTargetRecipe(rendered, "typecheck")).toContain("uv run mypy src");
    expect(makefileTargetRecipe(rendered, "security")).toContain("gitleaks detect --source . --no-git");
    expect(makefileTargetRecipe(rendered, "test")).toContain("uv run pytest");
    expect(makefileTargetRecipe(rendered, "coverage")).toContain("uv run pytest --cov=src --cov-fail-under=$(COVERAGE_THRESHOLD)");
    expect(makefileTargetRecipe(rendered, "deadcode")).toContain("uv run vulture src");
    expect(makefileTargetRecipe(rendered, "crap")).toContain("uv run pytest --crap");
    expect(makefileTargetRecipe(rendered, "audit")).toContain("uv export --extra dev --format requirements-txt --no-hashes");
    expect(makefileTargetRecipe(rendered, "audit")).toContain("uv run pip-audit --progress-spinner off --skip-editable -r /dev/stdin");
    expect(makefileTargetRecipe(rendered, "mutate")).toContain("uv run mutmut run");
    expect(makefileTargetLine(rendered, "quality")).toContain("check mutate");
    expect(makefileTargetLine(rendered, "check")).toContain("lint format typecheck security test coverage deadcode crap audit");
    expect(makefileTargetRecipe(rendered, "fix")).toContain("uv run ruff check --fix .");
    expect(makefileTargetRecipe(rendered, "fix")).toContain("uv run ruff format .");
    expect(rendered).not.toMatch(/\b(?:npx|bunx|npm|pnpm|yarn)\b/);
  });

  test("pre-commit template wires tier-1 hooks and pre-push check", async () => {
    const rendered = await renderPythonTemplate(".pre-commit-config.yaml.ejs");
    const config = parseYaml(rendered) as {
      default_install_hook_types?: string[];
      repos?: Array<{
        hooks?: Array<{ entry?: string; id?: string; language?: string; pass_filenames?: boolean; stages?: string[] }>;
      }>;
    };
    const hooks = new Map(
      (config.repos ?? [])
        .flatMap((repo) => repo.hooks ?? [])
        .filter((hook): hook is { id: string; stages?: string[] } => typeof hook.id === "string")
        .map((hook) => [hook.id, hook]),
    );

    expect(config.default_install_hook_types).toEqual(["pre-commit", "pre-push"]);
    for (const hook of ["lint", "format", "typecheck"]) {
      expect(hooks.get(hook)).toMatchObject({
        entry: `make ${hook}`,
        language: "system",
        pass_filenames: false,
        stages: expect.arrayContaining(["pre-commit"]),
      });
    }
    expect(hooks.get("check")).toMatchObject({
      entry: "make check",
      language: "system",
      pass_filenames: false,
      stages: expect.arrayContaining(["pre-push"]),
    });
    expect(hooks.get("gitleaks")?.stages).toContain("pre-commit");
  });

  test("Python support templates render concise guidance and config files", async () => {
    const agents = await renderPythonTemplate("AGENTS.md.ejs");
    const readme = await renderPythonTemplate("README.md.ejs", { projectName: "my-python-service" });
    const gitignore = await renderPythonTemplate(".gitignore.ejs");
    const flake8 = await renderPythonTemplate(".flake8.ejs");

    expect(agents.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    expect(agents).toContain("src/seed/");
    expect(agents).not.toMatch(/\b(disposable|starter|temporary|throwaway)\b/i);
    expect(readme).toContain("my-python-service");
    expect(readme).toContain('uv pip install -e ".[dev]"');
    expect(readme).toContain("make check");
    for (const ignored of ["__pycache__/", "*.py[cod]", ".venv/", ".ruff_cache/", ".mypy_cache/", ".pytest_cache/", "htmlcov/"]) {
      expect(gitignore).toContain(ignored);
    }
    expect(flake8).toMatch(/^select = ANV$/m);
    expect(flake8).toMatch(/^extend-exclude = \.venv,tools\/flake8-plugin$/m);
  });

  test("real Python manifest previews and scaffolds template entries", async () => {
    const targetDir = path.join(projectRoot, ".sandbox", "python-template-manifest-smoke");
    const ctx = makeContext({ targetDir });

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });

    try {
      const preview = await previewScaffold(ctx);
      expect(preview.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining(["pyproject.toml", "Makefile", ".pre-commit-config.yaml", "AGENTS.md", "README.md", ".gitignore", ".flake8"]),
      );
      expect(await Bun.file(path.join(targetDir, "pyproject.toml")).exists()).toBe(false);

      const result = await scaffold(ctx, {
        onReport: async () => {
          throw new Error("empty Python smoke target should not report conflicts");
        },
      });
      const renderedPyproject = Bun.TOML.parse(await readFile(path.join(targetDir, "pyproject.toml"), "utf8")) as {
        project?: { name?: string };
      };

      expect(result.filesCreated).toContain("pyproject.toml");
      expect(result.filesCreated).toContain("src/seed/seed.py");
      expect(renderedPyproject.project?.name).toBe("example-service");
      expect(await Bun.file(path.join(targetDir, ".anvil.lock")).exists()).toBe(true);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  });
});
