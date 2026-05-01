import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { getManifest } from "../../src/manifest.ts";
import { isTextFile, normalizeForChecksum } from "../../src/scaffold/lockfile.ts";
import type { AnvilLockfile, ScaffoldContext } from "../../src/types.ts";
import { assertRequiredTools, commandRequirement, python311Requirement } from "../support/required-tools.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");
const bunExecutable = process.execPath;
const bunExecutableDir = path.dirname(bunExecutable);
const anvilEntrypoint = path.join(repoRoot, "bin/anvil.ts");
const sandboxRoot = path.join(repoRoot, ".sandbox", `e2e-python-${randomUUID()}`);
const commandTimeoutMs = 600_000;
const suiteTimeoutMs = 900_000;
const seedLineThreshold = 100;
const suiteStartMs = performance.now();

const requiredPythonManifestFiles = [
  "src/seed/__init__.py",
  "src/seed/seed.py",
  "src/seed/types.py",
  "src/seed/errors.py",
  "src/seed/constants.py",
  "src/seed/enums.py",
  "tests/conftest.py",
  "tests/test_seed.py",
  "tools/flake8-plugin/anvil_lint/__init__.py",
  "tools/flake8-plugin/anvil_lint/anti_slop.py",
  "tools/flake8-plugin/anvil_lint/error_handling.py",
  "tools/flake8-plugin/anvil_lint/structural.py",
  "tools/flake8-plugin/anvil_lint/test_quality.py",
  "tools/flake8-plugin/setup.py",
  "tools/flake8-plugin/setup.cfg",
  "tools/flake8-plugin/tests/conftest.py",
  "tools/flake8-plugin/tests/test_anti_slop.py",
  "tools/flake8-plugin/tests/test_plugin.py",
  "tools/flake8-plugin/tests/test_structural.py",
  "tools/flake8-plugin/tests/test_test_quality.py",
  "pyproject.toml",
  ".flake8",
  "Makefile",
  ".pre-commit-config.yaml",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".gitleaks.toml",
  "flake.nix",
  "AGENTS.md",
  "README.md",
];

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface LabeledCommandResult {
  label: string;
  result: CommandResult;
}

function commandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${bunExecutableDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function run(command: string, args: string[], cwd: string, timeout = commandTimeoutMs): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: commandEnv(),
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

assertRequiredTools(
  "Python scaffold e2e",
  [
    commandRequirement("bun", bunExecutable),
    python311Requirement(),
    commandRequirement("uv"),
    commandRequirement("make"),
    commandRequirement("gitleaks"),
  ],
  {
    cwd: repoRoot,
    env: commandEnv(),
    nixEntrypoint: "bun run nix:test -- tests/e2e/python.test.ts",
  },
);

function expectSuccess(result: CommandResult, label: string): void {
  expect(result.error, `${label} failed to start`).toBeUndefined();
  expect(result.status, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
}

function expectFailure(result: CommandResult, label: string): string {
  expect(result.error, `${label} failed to start`).toBeUndefined();
  expect(result.status, `${label} unexpectedly passed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).not.toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

function scaffoldProject(name: string): string {
  const projectDir = path.join(sandboxRoot, name);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });

  const result = run(bunExecutable, [anvilEntrypoint, "init", "--lang", "python", "--non-interactive"], projectDir);
  expectSuccess(result, "anvil init --lang python --non-interactive");

  return projectDir;
}

function installProject(projectDir: string): LabeledCommandResult[] {
  return [
    { label: "uv sync", result: run("uv", ["sync"], projectDir) },
    { label: 'uv pip install -e ".[dev]"', result: run("uv", ["pip", "install", "-e", ".[dev]"], projectDir) },
    {
      label: "uv pip install -e tools/flake8-plugin/",
      result: run("uv", ["pip", "install", "-e", "tools/flake8-plugin/"], projectDir),
    },
  ];
}

function filesUnder(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory() && (entry.name === "__pycache__" || entry.name.endsWith(".egg-info"))) {
      return [];
    }
    if (entry.isFile() && /\.(?:pyc|pyo)$/.test(entry.name)) {
      return [];
    }

    if (entry.isDirectory()) {
      return filesUnder(entryPath);
    }

    return [entryPath];
  });
}

function relativePosixPath(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join(path.posix.sep);
}

function expectedManifestFiles(projectName: string): string[] {
  const context: ScaffoldContext = {
    projectName,
    lang: "python",
    targetDir: path.join(sandboxRoot, projectName),
    hasExistingCode: false,
    skipSeed: false,
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "test", python: "test" },
    anvilVersion: "0.1.0",
    year: new Date().getFullYear(),
  };

  return getManifest("python").entries
    .filter((entry) => entry.when === undefined || entry.when(context))
    .flatMap((entry) => {
      if (!entry.dest.endsWith("/**/*")) {
        return [entry.dest];
      }

      const srcRoot = path.join(repoRoot, entry.src.slice(0, -"/**/*".length));
      const destRoot = entry.dest.slice(0, -"/**/*".length);
      return filesUnder(srcRoot).map((filePath) => path.posix.join(destRoot, relativePosixPath(srcRoot, filePath)));
    })
    .sort((left, right) => left.localeCompare(right));
}

function parseLockfile(projectDir: string): AnvilLockfile {
  return JSON.parse(readFileSync(path.join(projectDir, ".anvil.lock"), "utf8")) as AnvilLockfile;
}

function checksumFile(filePath: string, relativePath: string): string {
  const content = readFileSync(filePath);
  const normalized = normalizeForChecksum(content, isTextFile(relativePath));
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function assertExpectedFiles(projectDir: string, expectedFiles: string[]): void {
  for (const relativePath of requiredPythonManifestFiles) {
    expect(expectedFiles, `${relativePath} must be represented in the Python manifest`).toContain(relativePath);
  }

  for (const relativePath of expectedFiles) {
    const fullPath = path.join(projectDir, relativePath);
    expect(existsSync(fullPath), `expected scaffolded file ${relativePath}`).toBe(true);
    expect(statSync(fullPath).isFile(), `expected scaffolded path ${relativePath} to be a file`).toBe(true);
    expect(readFileSync(fullPath, "utf8").length, `expected scaffolded file ${relativePath} to be non-empty`).toBeGreaterThan(0);
  }

  expect(existsSync(path.join(projectDir, ".anvil.lock")), "expected .anvil.lock").toBe(true);
}

function assertLockfile(projectDir: string, expectedFiles: string[]): void {
  const lockfile = parseLockfile(projectDir);
  const lockfilePaths = lockfile.files.map((file) => file.path).sort((left, right) => left.localeCompare(right));
  const manifestSources = [...new Set(getManifest("python").entries.map((entry) => entry.source))];

  expect(lockfile.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(lockfile.lang).toBe("python");
  expect(lockfile.flushStatus).toBe("complete");
  expect(lockfile.context).toMatchObject({
    projectName: path.basename(projectDir),
    defaultBranch: "main",
    skipSeed: false,
  });
  expect(typeof lockfile.context.year).toBe("number");
  expect(lockfile.context.sourceDir).toBeUndefined();
  expect(lockfile.context.packageManager).toBeUndefined();
  expect(lockfile.toolchain.bun).toMatch(/^\d+\.\d+\.\d+/);
  expect(lockfile.toolchain.python).toMatch(/^\d+\.\d+(?:\.\d+)?/);
  expect(lockfilePaths).not.toContain(".anvil.lock");
  expect(lockfilePaths).toEqual(expectedFiles);
  expect(manifestSources).toEqual(expect.arrayContaining(["static", "template"]));

  for (const entry of lockfile.files) {
    const fullPath = path.join(projectDir, entry.path);
    expect(entry.status, `${entry.path} lockfile status`).toBe("written");
    expect(entry.checksum, `${entry.path} checksum shape`).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(existsSync(fullPath), `${entry.path} referenced by lockfile`).toBe(true);
    expect(entry.checksum, `${entry.path} checksum`).toBe(checksumFile(fullPath, entry.path));
  }
}

function assertGeneratedDocsAndSeedThresholds(projectDir: string): void {
  const agentsText = readFileSync(path.join(projectDir, "AGENTS.md"), "utf8");
  const readmeText = readFileSync(path.join(projectDir, "README.md"), "utf8");
  const flakeText = readFileSync(path.join(projectDir, "flake.nix"), "utf8");
  const agentsLines = agentsText.trimEnd().split(/\r?\n/);
  expect(agentsLines.length).toBeLessThanOrEqual(40);
  expect(agentsText).toContain("nix develop path:.");
  expect(readmeText).toContain("nix develop path:.");
  expect(flakeText).toContain("pkgs.python311");
  expect(flakeText).toContain("pkgs.uv");
  expect(flakeText).not.toContain("pkgs.go");
  expect(flakeText).not.toContain("pkgs.bun");
  expect(agentsText).toContain("src/seed/");
  expect(agentsText).not.toMatch(/\b(disposable|starter|temporary|throwaway)\b/i);

  for (const relativePath of requiredPythonManifestFiles.filter((filePath) => filePath.startsWith("src/seed/"))) {
    const lineCount = readFileSync(path.join(projectDir, relativePath), "utf8").trimEnd().split(/\r?\n/).length;
    expect(lineCount, `${relativePath} line count`).toBeLessThanOrEqual(seedLineThreshold);
  }
}

function withRestoredFile(projectDir: string, relativePath: string, mutate: (fullPath: string) => void, assertViolation: () => void): void {
  const fullPath = path.join(projectDir, relativePath);
  const original = readFileSync(fullPath);

  try {
    mutate(fullPath);
    assertViolation();
  } finally {
    writeFileSync(fullPath, original);
  }
}

function assertLintFailure(projectDir: string, label: string, expectedPattern: RegExp): void {
  const output = expectFailure(run("make", ["lint"], projectDir), label);
  expect(output, label).toMatch(expectedPattern);
}

function assertInstallResults(results: LabeledCommandResult[]): void {
  for (const { label, result } of results) {
    expectSuccess(result, label);
  }
}

afterAll(() => {
  const suiteDurationMs = performance.now() - suiteStartMs;
  rmSync(sandboxRoot, { recursive: true, force: true });
  expect(suiteDurationMs, "Python E2E suite duration").toBeLessThanOrEqual(suiteTimeoutMs);
});

describe("Python scaffold e2e", () => {
    let positiveProjectDir = "";
    let installResults: LabeledCommandResult[] = [];

    beforeAll(() => {
      positiveProjectDir = scaffoldProject("test-python-project");
      installResults = installProject(positiveProjectDir);
    }, commandTimeoutMs);

    test("scaffolds expected files, validates .anvil.lock, and keeps generated guidance concise", () => {
      const expectedFiles = expectedManifestFiles("test-python-project");

      assertExpectedFiles(positiveProjectDir, expectedFiles);
      assertLockfile(positiveProjectDir, expectedFiles);
      assertGeneratedDocsAndSeedThresholds(positiveProjectDir);
    }, commandTimeoutMs);

    test("uv installs project dependencies and the local Flake8 plugin", () => {
      assertInstallResults(installResults);
      expect(existsSync(path.join(positiveProjectDir, ".venv")), "expected uv sync to create .venv").toBe(true);
    }, commandTimeoutMs);

    test("make lint, make test, and make coverage pass on clean Python seed code", () => {
      assertInstallResults(installResults);

      expectSuccess(run("make", ["lint"], positiveProjectDir), "make lint");

      const testResult = run("make", ["test"], positiveProjectDir);
      expectSuccess(testResult, "make test");
      expect(`${testResult.stdout}\n${testResult.stderr}`).toContain("test_seed.py");

      const coverageResult = run("make", ["coverage"], positiveProjectDir);
      expectSuccess(coverageResult, "make coverage");
      expect(`${coverageResult.stdout}\n${coverageResult.stderr}`).toMatch(/TOTAL\s+\d+\s+\d+(?:\s+\d+\s+\d+)?\s+\d+%/);
    }, commandTimeoutMs);

    test("make check passes when the full Python quality toolchain is present", () => {
      assertInstallResults(installResults);
      expectSuccess(run("make", ["check"], positiveProjectDir), "make check");
    }, commandTimeoutMs);

    test("make lint rejects isolated Python ANV violations and each mutation is restored", () => {
      const projectDir = scaffoldProject("invalid-lint");
      assertInstallResults(installProject(projectDir));

      withRestoredFile(
        projectDir,
        "src/seed/seed.py",
        (fullPath) =>
          appendFileSync(
            fullPath,
            "\n\ndef _bad_log_continue() -> None:\n    try:\n        _validate_name(\"Ada\")\n    except SeedError as error:\n        logging.error(error)\n",
            "utf8",
          ),
        () => assertLintFailure(projectDir, "make lint with log-and-continue", /ANV001|only logs/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring log-and-continue mutation");

      withRestoredFile(
        projectDir,
        "src/seed/seed.py",
        (fullPath) => appendFileSync(fullPath, "\n# TODO implement later\n", "utf8"),
        () => assertLintFailure(projectDir, "make lint with placeholder comment", /ANV003|placeholder/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring placeholder mutation");

      withRestoredFile(
        projectDir,
        "src/seed/seed.py",
        (fullPath) => appendFileSync(fullPath, "\nprint(\"debug\")\n", "utf8"),
        () => assertLintFailure(projectDir, "make lint with print usage", /ANV006|print\(\)/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring print mutation");

      withRestoredFile(
        projectDir,
        "tests/test_seed.py",
        (fullPath) => appendFileSync(fullPath, "\n\ndef test_nothing() -> None:\n    greet(\"Ada\")\n", "utf8"),
        () => assertLintFailure(projectDir, "make lint with empty test", /ANV201|no assertion/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring empty-test mutation");

      withRestoredFile(
        projectDir,
        "src/seed/seed.py",
        (fullPath) => {
          const source = readFileSync(fullPath, "utf8").replace("import logging\n\n", "import logging\nfrom typing import TypedDict\n\n");
          writeFileSync(
            fullPath,
            `${source}\n\nclass BadType(TypedDict):\n    \"\"\"Bad exported type in wrong module.\"\"\"\n\n    field: str\n`,
            "utf8",
          );
        },
        () => assertLintFailure(projectDir, "make lint with type in seed.py", /ANV103|types\.py/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring type-organization mutation");
    }, commandTimeoutMs);
});
