import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, test } from "bun:test";

import { getManifest } from "../../src/manifest.ts";
import { isTextFile, normalizeForChecksum } from "../../src/scaffold/lockfile.ts";
import type { AnvilLockfile, ScaffoldContext } from "../../src/types.ts";

const repoRoot = path.resolve(import.meta.dir, "../..");
const bunExecutable = process.execPath;
const anvilEntrypoint = path.join(repoRoot, "bin/anvil.ts");
const sandboxRoot = path.join(repoRoot, ".sandbox", `e2e-golang-${randomUUID()}`);
const commandTimeoutMs = 300_000;
const requiredGoManifestFiles = [
  "internal/seed/seed.go",
  "internal/seed/seed_test.go",
  "internal/seed/types.go",
  "internal/seed/errors.go",
  "internal/seed/constants.go",
  "internal/seed/enums.go",
  "cmd/app/main.go",
  "tools/tools.go",
  "tools/go-analyzers/cmd/anvil-lint/main.go",
  "tools/go-analyzers/cmd/crap-report/main.go",
  "tools/go-analyzers/cmd/crap-report/main_test.go",
  "tools/go-analyzers/go.mod",
  "tools/go-analyzers/go.sum",
  "tools/go-analyzers/Makefile",
  "tools/go-analyzers/anti_slop/noerrorobscuring/analyzer.go",
  "tools/go-analyzers/anti_slop/noerrorobscuring/analyzer_test.go",
  "tools/go-analyzers/anti_slop/nologcontinue/analyzer.go",
  "tools/go-analyzers/anti_slop/nologcontinue/analyzer_test.go",
  "tools/go-analyzers/anti_slop/nologthrow/analyzer.go",
  "tools/go-analyzers/anti_slop/nologthrow/analyzer_test.go",
  "tools/go-analyzers/anti_slop/nopassthrough/analyzer.go",
  "tools/go-analyzers/anti_slop/nopassthrough/analyzer_test.go",
  "tools/go-analyzers/anti_slop/noplaceholder/analyzer.go",
  "tools/go-analyzers/anti_slop/noplaceholder/analyzer_test.go",
  "tools/go-analyzers/anti_slop/nosilenterrorswallow/analyzer.go",
  "tools/go-analyzers/anti_slop/nosilenterrorswallow/analyzer_test.go",
  "tools/go-analyzers/anti_slop/requiretests/analyzer.go",
  "tools/go-analyzers/anti_slop/requiretests/analyzer_test.go",
  "tools/go-analyzers/anti_slop/structuredlog/analyzer.go",
  "tools/go-analyzers/anti_slop/structuredlog/analyzer_test.go",
  "tools/go-analyzers/internal/analyzerutil/util.go",
  "tools/go-analyzers/structural/filelength/analyzer.go",
  "tools/go-analyzers/structural/filelength/analyzer_test.go",
  "tools/go-analyzers/structural/noexportedfunctionexpressions/analyzer.go",
  "tools/go-analyzers/structural/noexportedfunctionexpressions/analyzer_test.go",
  "tools/go-analyzers/test_quality/nodisabledtest/analyzer.go",
  "tools/go-analyzers/test_quality/nodisabledtest/analyzer_test.go",
  "tools/go-analyzers/test_quality/noemptytest/analyzer.go",
  "tools/go-analyzers/test_quality/noemptytest/analyzer_test.go",
  "tools/go-analyzers/test_quality/notautological/analyzer.go",
  "tools/go-analyzers/test_quality/notautological/analyzer_test.go",
  "tools/go-analyzers/test_quality/requireerrortest/analyzer.go",
  "tools/go-analyzers/test_quality/requireerrortest/analyzer_test.go",
  "tools/go-analyzers/testdata/.gitkeep",
  "go.mod",
  ".golangci.yml",
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

function availability(required: string[]): ToolGate {
  const missing = required.filter((command) => {
    if (path.isAbsolute(command)) {
      return !existsSync(command) || !statSync(command).isFile();
    }

    const result = spawnSync("which", [command], { encoding: "utf8", timeout: 5_000 });
    return result.status !== 0;
  });

  return { available: missing.length === 0, missing };
}

const scaffoldTools = availability([bunExecutable, "go", "make"]);
const lintTools = availability(["go", "make", "golangci-lint"]);
const checkTools = availability(["go", "make", "golangci-lint", "staticcheck", "deadcode", "govulncheck", "gitleaks"]);

function run(command: string, args: string[], cwd: string, timeout = commandTimeoutMs): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: process.env,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function expectSuccess(result: CommandResult, label: string): void {
  expect(result.error, `${label} failed to start`).toBeUndefined();
  expect(result.status, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
}

function scaffoldProject(name: string): string {
  const projectDir = path.join(sandboxRoot, name);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });

  const result = run(bunExecutable, [anvilEntrypoint, "init", "--lang", "golang", "--non-interactive"], projectDir);
  expectSuccess(result, "anvil init --lang golang --non-interactive");

  return projectDir;
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
    lang: "golang",
    targetDir: path.join(sandboxRoot, projectName),
    hasExistingCode: false,
    skipSeed: false,
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "test", go: "test" },
    anvilVersion: "0.1.0",
    year: new Date().getFullYear(),
  };

  return getManifest("golang").entries
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
  for (const relativePath of requiredGoManifestFiles) {
    expect(expectedFiles, `${relativePath} must be represented in the Go manifest`).toContain(relativePath);
    expect(existsSync(path.join(projectDir, relativePath)), `required Go output file ${relativePath}`).toBe(true);
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

  expect(lockfile.lang).toBe("golang");
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
  expect(lockfile.toolchain.go).toMatch(/^\d+\.\d+(?:\.\d+)?/);
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

afterAll(() => {
  rmSync(sandboxRoot, { recursive: true, force: true });
});

if (!scaffoldTools.available) {
  describe("Go scaffold e2e", () => {
    test.skip(`requires missing tools: ${scaffoldTools.missing.join(", ")}`, () => {});
  });
} else {
  describe("Go scaffold e2e", () => {
    test("scaffolds expected files, validates .anvil.lock, and keeps AGENTS.md concise", () => {
      const projectDir = scaffoldProject("valid-output");
      const expectedFiles = expectedManifestFiles("valid-output");

      assertExpectedFiles(projectDir, expectedFiles);
      assertLockfile(projectDir, expectedFiles);

      const agentsLines = readFileSync(path.join(projectDir, "AGENTS.md"), "utf8").trimEnd().split(/\r?\n/);
      expect(agentsLines.length).toBeLessThanOrEqual(40);
    }, commandTimeoutMs);

    test("go mod tidy and make test pass on clean seed code", () => {
      const projectDir = scaffoldProject("valid-test");

      expectSuccess(run("go", ["mod", "tidy"], projectDir), "go mod tidy");
      expectSuccess(run("make", ["test"], projectDir), "make test");
    }, commandTimeoutMs);

    const lintTest = lintTools.available ? test : test.skip;
    lintTest("make lint passes and lazily builds the custom analyzer binary", () => {
      const projectDir = scaffoldProject("valid-lint");
      const analyzerBinary = path.join(projectDir, "tools/go-analyzers/bin/anvil-lint");

      expect(existsSync(analyzerBinary)).toBe(false);
      expectSuccess(run("make", ["lint"], projectDir), "make lint");
      expect(existsSync(analyzerBinary)).toBe(true);
    }, commandTimeoutMs);

    const checkTest = checkTools.available ? test : test.skip;
    checkTest("make check passes when the full Go quality toolchain is present", () => {
      const projectDir = scaffoldProject("valid-check");

      expectSuccess(run("make", ["check"], projectDir), "make check");
    }, commandTimeoutMs);

    lintTest("make lint fails when a custom analyzer violation is introduced", () => {
      const projectDir = scaffoldProject("invalid-lint");
      appendFileSync(path.join(projectDir, "internal/seed/seed.go"), "\n// TODO: implement later\n", "utf8");

      const result = run("make", ["lint"], projectDir);
      expect(result.error, "make lint failed to start").toBeUndefined();
      expect(result.status, `make lint unexpectedly passed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("placeholder comment");
    }, commandTimeoutMs);
  });
}
