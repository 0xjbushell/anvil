import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, test } from "bun:test";

import { getManifest } from "../../src/manifest.ts";
import { isTextFile, normalizeForChecksum } from "../../src/scaffold/lockfile.ts";
import type { AnvilLockfile, ScaffoldContext } from "../../src/types.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");
const bunExecutable = process.execPath;
const bunExecutableDir = path.dirname(bunExecutable);
const anvilEntrypoint = path.join(repoRoot, "bin/anvil.ts");
const sandboxRoot = path.join(repoRoot, ".sandbox", `e2e-typescript-${randomUUID()}`);
const commandTimeoutMs = 600_000;
const suiteTimeoutMs = 600_000;
const seedLineThreshold = 100;
const suiteStartMs = Date.now();

const requiredTypeScriptManifestFiles = [
  "src/seed/seed.ts",
  "src/seed/seed.test.ts",
  "src/seed/types.ts",
  "src/seed/errors.ts",
  "src/seed/constants.ts",
  "src/seed/enums.ts",
  "tools/lint-rules/plugin.js",
  "tools/lint-rules/package.json",
  "tools/lint-rules/anti-slop/.gitkeep",
  "tools/lint-rules/anti-slop/ast-utils.js",
  "tools/lint-rules/anti-slop/no-async-noise.js",
  "tools/lint-rules/anti-slop/no-error-obscuring.js",
  "tools/lint-rules/anti-slop/no-log-and-continue.js",
  "tools/lint-rules/anti-slop/no-log-and-throw.js",
  "tools/lint-rules/anti-slop/no-pass-through-wrapper.js",
  "tools/lint-rules/anti-slop/no-placeholder-comments.js",
  "tools/lint-rules/anti-slop/require-structured-logging.js",
  "tools/lint-rules/anti-slop/require-test-files.js",
  "tools/lint-rules/error-handling/.gitkeep",
  "tools/lint-rules/error-handling/no-silent-error-swallow.js",
  "tools/lint-rules/structural/.gitkeep",
  "tools/lint-rules/structural/constants-file-organization.js",
  "tools/lint-rules/structural/enums-file-organization.js",
  "tools/lint-rules/structural/errors-file-organization.js",
  "tools/lint-rules/structural/filename-match-export.js",
  "tools/lint-rules/structural/no-barrel-density.js",
  "tools/lint-rules/structural/no-exported-function-expressions.js",
  "tools/lint-rules/structural/no-over-fragmentation.js",
  "tools/lint-rules/structural/types-file-organization.js",
  "tools/lint-rules/structural/utils.js",
  "tools/lint-rules/test-quality/.gitkeep",
  "tools/lint-rules/test-quality/no-disabled-tests-without-reason.js",
  "tools/lint-rules/test-quality/no-empty-tests.js",
  "tools/lint-rules/test-quality/no-snapshot-only-tests.js",
  "tools/lint-rules/test-quality/no-tautological-assertions.js",
  "tools/lint-rules/test-quality/require-error-path-tests.js",
  "tools/lint-rules/test-quality/utils.js",
  "tools/crap-score.ts",
  "eslint.config.mjs",
  "tsconfig.json",
  ".prettierrc",
  "package.json",
  "vitest.config.ts",
  "knip.json",
  "stryker.config.mjs",
  "Makefile",
  ".pre-commit-config.yaml",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".gitleaks.toml",
  "AGENTS.md",
  "README.md",
];

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface ToolGate {
  available: boolean;
  missing: string[];
}

function commandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${bunExecutableDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function availability(required: string[]): ToolGate {
  const missing = required.filter((command) => {
    if (path.isAbsolute(command)) {
      return !existsSync(command) || !statSync(command).isFile();
    }

    const result = spawnSync("which", [command], { encoding: "utf8", timeout: 5_000, env: commandEnv() });
    return result.status !== 0;
  });

  return { available: missing.length === 0, missing };
}

const scaffoldTools = availability([bunExecutable, "node", "make"]);
const externalCheckTools = availability(["gitleaks"]);

function run(command: string, args: string[], cwd: string, timeout = commandTimeoutMs): CommandResult {
  try {
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
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    return {
      status: null,
      stdout: "",
      stderr: normalizedError.message,
      error: normalizedError,
    };
  }
}

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

  const result = run(bunExecutable, [anvilEntrypoint, "init", "--lang", "typescript", "--non-interactive"], projectDir);
  expectSuccess(result, "anvil init --lang typescript --non-interactive");

  return projectDir;
}

function installProject(projectDir: string): void {
  expectSuccess(run(bunExecutable, ["install"], projectDir), "bun install");
  expect(existsSync(path.join(projectDir, "node_modules")), "expected scaffolded node_modules after bun install").toBe(true);
}

function filesUnder(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
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
    lang: "typescript",
    targetDir: path.join(sandboxRoot, projectName),
    hasExistingCode: false,
    skipSeed: false,
    defaultBranch: "main",
    nonInteractive: true,
    packageManager: "bun",
    toolchain: { bun: "test", node: "test" },
    anvilVersion: "0.1.0",
    year: new Date().getFullYear(),
  };

  return getManifest("typescript").entries
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
  for (const relativePath of requiredTypeScriptManifestFiles) {
    expect(expectedFiles, `${relativePath} must be represented in the TypeScript manifest`).toContain(relativePath);
    expect(existsSync(path.join(projectDir, relativePath)), `required TypeScript output file ${relativePath}`).toBe(true);
  }

  for (const relativePath of expectedFiles) {
    const fullPath = path.join(projectDir, relativePath);
    expect(existsSync(fullPath), `expected scaffolded file ${relativePath}`).toBe(true);
    expect(statSync(fullPath).isFile(), `expected scaffolded path ${relativePath} to be a file`).toBe(true);
  }

  expect(existsSync(path.join(projectDir, ".anvil.lock")), "expected .anvil.lock").toBe(true);
}

function assertLockfile(projectDir: string, expectedFiles: string[]): void {
  const lockfile = parseLockfile(projectDir);
  const lockfilePaths = lockfile.files.map((file) => file.path).sort((left, right) => left.localeCompare(right));

  expect(lockfile.lang).toBe("typescript");
  expect(lockfile.flushStatus).toBe("complete");
  expect(lockfile.context).toMatchObject({
    projectName: path.basename(projectDir),
    packageManager: "bun",
    defaultBranch: "main",
    skipSeed: false,
  });
  expect(typeof lockfile.context.year).toBe("number");
  expect(lockfile.context.sourceDir).toBeUndefined();
  expect(lockfile.toolchain.bun).toMatch(/^\d+\.\d+\.\d+/);
  expect(lockfile.toolchain.node).toMatch(/^\d+\.\d+\.\d+/);
  expect(lockfilePaths).not.toContain(".anvil.lock");
  expect(lockfilePaths).toEqual(expectedFiles);

  for (const entry of lockfile.files) {
    const fullPath = path.join(projectDir, entry.path);
    expect(entry.status, `${entry.path} lockfile status`).toBe("written");
    expect(entry.checksum, `${entry.path} checksum shape`).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(existsSync(fullPath), `${entry.path} referenced by lockfile`).toBe(true);
    expect(entry.checksum, `${entry.path} checksum`).toBe(checksumFile(fullPath, entry.path));
  }
}

function assertGeneratedDocsAndSeedThresholds(projectDir: string): void {
  const agentsLines = readFileSync(path.join(projectDir, "AGENTS.md"), "utf8").trimEnd().split(/\r?\n/);
  expect(agentsLines.length).toBeLessThanOrEqual(40);

  for (const relativePath of requiredTypeScriptManifestFiles.filter((filePath) => filePath.startsWith("src/seed/"))) {
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

afterAll(() => {
  const suiteDurationMs = Date.now() - suiteStartMs;
  rmSync(sandboxRoot, { recursive: true, force: true });
  expect(suiteDurationMs, "TypeScript E2E suite duration").toBeLessThanOrEqual(suiteTimeoutMs);
});

if (!scaffoldTools.available) {
  describe("TypeScript scaffold e2e", () => {
    test.skip(`requires missing tools: ${scaffoldTools.missing.join(", ")}`, () => {});
  });
} else {
  describe("TypeScript scaffold e2e", () => {
    test("scaffolds expected files, validates .anvil.lock, and keeps generated guidance concise", () => {
      const projectDir = scaffoldProject("valid-output");
      const expectedFiles = expectedManifestFiles("valid-output");

      assertExpectedFiles(projectDir, expectedFiles);
      assertLockfile(projectDir, expectedFiles);
      assertGeneratedDocsAndSeedThresholds(projectDir);
    }, commandTimeoutMs);

    test("bun install and offline make targets pass on clean seed code", () => {
      const projectDir = scaffoldProject("valid-toolchain");

      installProject(projectDir);
      expectSuccess(run("make", ["lint"], projectDir), "make lint");
      expectSuccess(run("make", ["test"], projectDir), "make test");
      expectSuccess(run("make", ["format"], projectDir), "make format");
      expectSuccess(run("make", ["typecheck"], projectDir), "make typecheck");
      expectSuccess(run("make", ["coverage"], projectDir), "make coverage");
      expectSuccess(run("make", ["deadcode"], projectDir), "make deadcode");
      expectSuccess(run("make", ["crap"], projectDir), "make crap");
    }, commandTimeoutMs);

    const makeCheckTest = externalCheckTools.available ? test : test.skip;
    makeCheckTest(`make check passes when external quality tools are available${externalCheckTools.available ? "" : ` (missing: ${externalCheckTools.missing.join(", ")})`}`, () => {
      const projectDir = scaffoldProject("valid-check");

      installProject(projectDir);
      expectSuccess(run("make", ["check"], projectDir), "make check");
    }, commandTimeoutMs);

    test("make lint rejects isolated negative mutations and each mutation is restored", () => {
      const projectDir = scaffoldProject("invalid-lint");

      installProject(projectDir);

      withRestoredFile(
        projectDir,
        "src/seed/seed.ts",
        (fullPath) => appendFileSync(fullPath, "\nconsole.log(\"debug\");\n", "utf8"),
        () => assertLintFailure(projectDir, "make lint with console.log", /no-console|Unexpected console/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring console.log mutation");

      withRestoredFile(
        projectDir,
        "src/seed/seed.test.ts",
        (fullPath) => rmSync(fullPath),
        () => assertLintFailure(projectDir, "make lint with missing seed.test.ts", /missingTestFile|corresponding test file|seed\.test\.ts/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring seed.test.ts mutation");

      withRestoredFile(
        projectDir,
        "src/seed/seed.ts",
        (fullPath) => appendFileSync(fullPath, "\n// TODO: implement later\n", "utf8"),
        () => assertLintFailure(projectDir, "make lint with placeholder comment", /placeholder comment|no-placeholder-comments|TODO/i),
      );
      expectSuccess(run("make", ["lint"], projectDir), "make lint after restoring placeholder mutation");
    }, commandTimeoutMs);
  });
}
