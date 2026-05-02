import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { compare } from "../internal/dir-compare/compare.ts";
import { main, runAgentCheck } from "./cli.ts";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const fixtureInputRoot = path.join(repoRoot, "tests", "fixtures", "inputs");
const sandboxRoot = path.join(repoRoot, ".sandbox");
const scratchTarget = path.join(sandboxRoot, "scratch");
const bunExecutable = "bun" in process.versions ? process.execPath : "bun";

const createdTargets = new Set<string>();

interface DevRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CliRootOverrides {
  repoRoot?: string;
  scenarioRoot?: string;
  inputRoot?: string;
  sandboxRoot?: string;
  tempRoot?: string;
  changedFiles?: string[];
}

class StringWriter {
  text = "";

  write(chunk: string | Uint8Array): boolean {
    this.text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }
}

function runDev(args: string[]): Promise<DevRun> {
  return runPackageScript("dev", args);
}

function runPackageScript(script: string, args: string[] = [], env: Record<string, string> = {}): Promise<DevRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(bunExecutable, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function runCommand(command: string, args: string[], cwd: string): Promise<DevRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runGit(args: string[], cwd: string): Promise<void> {
  const result = await runCommand("git", args, cwd);
  expect(result.exitCode, `git ${args.join(" ")}\n${result.stderr}`).toBe(0);
}

async function runMain(args: string[], roots: CliRootOverrides = {}): Promise<DevRun> {
  const stdout = new StringWriter();
  const stderr = new StringWriter();
  const exitCode = await main(args, { stdout, stderr }, roots);

  return {
    exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
  };
}

async function runAgentCheckMain(args: string[], roots: CliRootOverrides = {}): Promise<DevRun> {
  const stdout = new StringWriter();
  const stderr = new StringWriter();
  const exitCode = await runAgentCheck(args, { stdout, stderr }, roots);

  return {
    exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function outputLines(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\r?\n/);
}

async function expectTargetMatchesInput(target: string, input = "greenfield"): Promise<void> {
  const result = await compare(path.join(fixtureInputRoot, input), target, { compareContent: true, compareSize: true });
  expect(result.same, result.diffSet.map((diff) => diff.relativePath).join(", ")).toBe(true);
}

function shellQuoteForHint(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

afterEach(async () => {
  await rm(scratchTarget, { recursive: true, force: true });
  for (const target of createdTargets) {
    await rm(target, { recursive: true, force: true });
  }
  createdTargets.clear();
});

describe("bun dev scenario sandbox CLI", () => {
  test("bun dev greenfield-typescript creates .sandbox/scratch matching the greenfield input and prints a hint", async () => {
    createdTargets.add(scratchTarget);

    const result = await runDev(["greenfield-typescript"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${scratchTarget}\n`);
    expect(result.stderr).toContain(`cd ${scratchTarget}`);
    expect(result.stderr).toContain("bin/anvil");
    await expectTargetMatchesInput(scratchTarget);
  });

  test("default runs wipe and recopy .sandbox/scratch", async () => {
    createdTargets.add(scratchTarget);

    expect((await runDev(["greenfield-typescript"])).exitCode).toBe(0);
    const extraFile = path.join(scratchTarget, "extra.txt");
    await writeFile(extraFile, "remove me\n", "utf8");
    expect(await pathExists(extraFile)).toBe(true);

    const result = await runDev(["greenfield-typescript"]);

    expect(result.exitCode).toBe(0);
    expect(await pathExists(extraFile)).toBe(false);
    await expectTargetMatchesInput(scratchTarget);
  });

  test("--keep preserves added files while overlaying the input copy", async () => {
    createdTargets.add(scratchTarget);

    expect((await runDev(["with-existing-code"])).exitCode).toBe(0);
    const extraFile = path.join(scratchTarget, "keep-me.txt");
    await writeFile(extraFile, "keep me\n", "utf8");
    const copiedSourceFile = path.join(scratchTarget, "src", "foo.ts");
    await writeFile(copiedSourceFile, "drifted\n", "utf8");

    const result = await runDev(["with-existing-code", "--keep"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${scratchTarget}\n`);
    expect(await pathExists(extraFile)).toBe(true);
    expect(await readFile(copiedSourceFile, "utf8")).toBe(
      await readFile(path.join(fixtureInputRoot, "with-existing-code", "src", "foo.ts"), "utf8"),
    );
  });

  test("--name copies into .sandbox/<dirname> and prints that absolute path", async () => {
    const name = `cli-test-${randomUUID()}`;
    const target = path.join(sandboxRoot, name);
    createdTargets.add(target);

    const result = await runDev(["greenfield-typescript", "--name", name]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${target}\n`);
    expect(result.stderr).toContain(`cd ${target}`);
    await expectTargetMatchesInput(target);
  });

  test("scenario names resolve YAML files whose input differs from the scenario name", async () => {
    const root = path.join(sandboxRoot, `cli-test-alias-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const targetRoot = path.join(root, "targets");
    const target = path.join(targetRoot, "scratch");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "alias.yaml"),
      "name: alias\ninput: with-existing-code\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );

    const result = await runMain(["alias"], {
      scenarioRoot,
      inputRoot: fixtureInputRoot,
      sandboxRoot: targetRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${target}\n`);
    expect(result.stderr).toContain(`cd ${target}`);
    await expectTargetMatchesInput(target, "with-existing-code");
  });

  test("stderr hint shell-quotes target paths with spaces and quotes", async () => {
    const root = path.join(sandboxRoot, `cli test's ${randomUUID()}`);
    const target = path.join(root, "scratch");
    createdTargets.add(root);

    const result = await runMain(["greenfield-typescript"], { sandboxRoot: root });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${target}\n`);
    expect(result.stderr).toContain(`cd ${shellQuoteForHint(target)} &&`);
    await expectTargetMatchesInput(target);
  });

  test("unsafe --name values are rejected", async () => {
    const result = await runDev(["greenfield", "--name", "../outside"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unsafe --name");
    expect(result.stderr).toContain("path separators");
  });

  test("--keep rejects symlinked existing targets before overlaying", async () => {
    const root = path.join(sandboxRoot, `cli-test-symlink-${randomUUID()}`);
    createdTargets.add(root);
    const target = path.join(root, "scratch");
    const outside = path.join(root, "outside");
    await mkdir(target, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(target, "src"), "dir");

    const result = await runMain(["with-existing-code", "--keep"], { sandboxRoot: root });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("symlink");
    expect(await pathExists(path.join(outside, "foo.ts"))).toBe(false);
  });

  test("missing and invalid scenario errors are clear", async () => {
    const missing = await runDev(["missing-scenario"]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain('scenario "missing-scenario" not found');

    const invalidRoot = path.join(sandboxRoot, `cli-test-invalid-${randomUUID()}`);
    createdTargets.add(invalidRoot);
    const scenarioRoot = path.join(invalidRoot, "scenarios");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(path.join(scenarioRoot, "invalid.yaml"), "name: invalid\ninput: greenfield\nexpect: {}\n", "utf8");
    await writeFile(
      path.join(scenarioRoot, "missing-input.yaml"),
      "name: missing-input\ninput: does-not-exist\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );

    const invalid = await runMain(["invalid"], {
      scenarioRoot,
      inputRoot: fixtureInputRoot,
      sandboxRoot: path.join(invalidRoot, "sandbox"),
    });
    expect(invalid.exitCode).not.toBe(0);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toMatch(/invalid scenario "invalid".*exactly one/i);

    const missingInput = await runMain(["missing-input"], {
      scenarioRoot,
      inputRoot: fixtureInputRoot,
      sandboxRoot: path.join(invalidRoot, "sandbox"),
    });
    expect(missingInput.exitCode).not.toBe(0);
    expect(missingInput.stdout).toBe("");
    expect(missingInput.stderr).toContain('input fixture "does-not-exist" not found');
  });

  test("copy preserves executable file modes supported by fs.cp", async () => {
    const root = path.join(sandboxRoot, `cli-test-mode-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const inputRoot = path.join(root, "inputs");
    const inputDir = path.join(inputRoot, "mode-input");
    const targetRoot = path.join(root, "targets");
    const targetScript = path.join(targetRoot, "scratch", "run.sh");
    await mkdir(scenarioRoot, { recursive: true });
    await mkdir(inputDir, { recursive: true });
    await writeFile(path.join(inputDir, "run.sh"), "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(path.join(inputDir, "run.sh"), 0o755);
    await writeFile(
      path.join(scenarioRoot, "mode.yaml"),
      "name: mode\ninput: mode-input\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );

    const result = await runMain(["mode"], {
      scenarioRoot,
      inputRoot,
      sandboxRoot: targetRoot,
    });

    expect(result.exitCode).toBe(0);
    expect((await stat(targetScript)).mode & 0o777).toBe(0o755);
  });

  test(".gitignore ignores scratch contents while allowing .sandbox/.gitkeep", async () => {
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
    const lines = gitignore.split(/\r?\n/).map((line) => line.trim());

    expect(lines).toContain(".sandbox/*");
    expect(lines).toContain("!.sandbox/.gitkeep");
    expect(lines).not.toContain(".sandbox/");
  });
});

describe("bun fixtures regression CLI", () => {
  test("package script exposes bun fixtures", async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

    expect(pkg.scripts?.fixtures).toBe("bun src/dev/cli.ts fixtures");
  });

  test("bun fixtures runs all committed scenarios and prints a passing summary", async () => {
    const tmpRoot = path.join(sandboxRoot, `cli-test-fixtures-all-${randomUUID()}`);
    createdTargets.add(tmpRoot);
    await mkdir(tmpRoot, { recursive: true });
    const scenarioRoot = path.join(repoRoot, "tests", "fixtures", "scenarios");
    const scenarioFiles = (await readdir(scenarioRoot)).filter((name) => name.endsWith(".yaml")).sort();

    const result = await runPackageScript("fixtures", [], { TMPDIR: tmpRoot });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("error:");
    expect(result.stderr).not.toContain("failures for");
    const lines = outputLines(result.stdout);
    const passLines = lines.filter((line) => line.includes(" passed in "));
    expect(passLines).toHaveLength(scenarioFiles.length);
    for (const scenarioFile of scenarioFiles) {
      const scenarioName = scenarioFile.replace(/\.yaml$/, "");
      expect(passLines.some((line) => line.includes(` ${scenarioName} passed in `))).toBe(true);
    }
    expect(lines.at(-1)).toContain(`(${scenarioFiles.length} passed, 0 failed in `);
  }, 180_000);

  test("--filter runs only scenarios whose parsed names contain the substring", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-filter-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "selected.yaml"),
      [
        "name: alpha-drift",
        "description: Version behavior fixture used to prove filter selection.",
        "input: greenfield",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 0",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(scenarioRoot, "control.yaml"),
      [
        "name: beta-clean",
        "description: Version behavior fixture used to prove filter selection.",
        "input: greenfield",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 0",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runMain(["fixtures", "--filter", "drift"], { scenarioRoot, tempRoot: tmpRoot });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const lines = outputLines(result.stdout);
    const passLines = lines.filter((line) => line.includes(" passed in "));
    expect(passLines).toHaveLength(1);
    expect(passLines[0]).toContain(" alpha-drift passed in ");
    expect(result.stdout).not.toContain("beta-clean");
    expect(lines.at(-1)).toContain("(1 passed, 0 failed in ");
  });

  test("bun fixtures gives each scenario isolated HOME, temp, cache, hook, and PTY state", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-isolation-${randomUUID()}`);
    createdTargets.add(root);
    const inputRoot = path.join(root, "inputs");
    const scenarioRoot = path.join(root, "scenarios");
    await mkdir(scenarioRoot, { recursive: true });

    for (const name of ["alpha", "beta"]) {
      const inputDir = path.join(inputRoot, name);
      await mkdir(inputDir, { recursive: true });
      await writeFile(
        path.join(inputDir, "setup.sh"),
        [
          "#!/usr/bin/env sh",
          "set -eu",
          "printf 'HOME=%s\\n' \"$HOME\" > env.txt",
          "printf 'TMPDIR=%s\\n' \"$TMPDIR\" >> env.txt",
          "printf 'XDG_CACHE_HOME=%s\\n' \"${XDG_CACHE_HOME:-}\" >> env.txt",
          "printf 'GOCACHE=%s\\n' \"${GOCACHE:-}\" >> env.txt",
          "printf 'GOMODCACHE=%s\\n' \"${GOMODCACHE:-}\" >> env.txt",
          "printf 'GOLANGCI_LINT_CACHE=%s\\n' \"${GOLANGCI_LINT_CACHE:-}\" >> env.txt",
          "printf 'GIT_CONFIG_GLOBAL=%s\\n' \"${GIT_CONFIG_GLOBAL:-}\" >> env.txt",
          "printf 'HUSKY=%s\\n' \"${HUSKY:-}\" >> env.txt",
          "printf 'ANVIL_PTY_STATE_DIR=%s\\n' \"${ANVIL_PTY_STATE_DIR:-}\" >> env.txt",
          "",
        ].join("\n"),
        "utf8",
      );
      await chmod(path.join(inputDir, "setup.sh"), 0o755);
      await writeFile(
        path.join(scenarioRoot, `${name}.yaml`),
        [
          `name: ${name}`,
          "description: Version behavior fixture used to prove per-scenario env isolation.",
          `input: ${name}`,
          "args:",
          "  - --version",
          "expect:",
          "  exit_code: 0",
          "  files_match_regex:",
          "    - file: env.txt",
          "      pattern: 'HOME=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'TMPDIR=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'XDG_CACHE_HOME=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'GOCACHE=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'GOMODCACHE=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'GOLANGCI_LINT_CACHE=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'GIT_CONFIG_GLOBAL=.*/\\.anvil-env/.+'",
          "    - file: env.txt",
          "      pattern: 'ANVIL_PTY_STATE_DIR=.*/\\.anvil-env/.+'",
          "  files_contain:",
          "    - file: env.txt",
          "      matches: 'HUSKY=0'",
          "",
        ].join("\n"),
        "utf8",
      );
    }

    const result = await runMain(["fixtures"], { scenarioRoot, inputRoot });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(" alpha passed in ");
    expect(result.stdout).toContain(" beta passed in ");
  });

  test("a broken scenario exits non-zero and reports failures with the preserved workdir", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-broken-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "broken.yaml"),
      [
        "name: broken-fixture",
        "description: Version behavior fixture with an intentionally wrong assertion.",
        "input: greenfield",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 99",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runMain(["fixtures"], { scenarioRoot, tempRoot: tmpRoot });

    expect(result.exitCode).toBe(1);
    const lines = outputLines(result.stdout);
    const failLines = lines.filter((line) => line.includes(" broken-fixture failed in "));
    expect(failLines).toHaveLength(1);
    expect(lines.at(-1)).toContain("(0 passed, 1 failed in ");
    expect(result.stderr).toContain("failures for broken-fixture:");
    expect(result.stderr).toContain("exit_code: expected 99, got 0");
    const workdir = result.stderr.match(/^workdir: (.+)$/m)?.[1];
    expect(workdir).toBeDefined();
    expect(await pathExists(workdir ?? "")).toBe(true);
  });

  test("a setup.sh failure exits non-zero and reports setup output with the preserved workdir", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-setup-failure-${randomUUID()}`);
    const inputName = `cli-setup-failure-${randomUUID()}`;
    const inputRoot = path.join(root, "inputs");
    const inputDir = path.join(inputRoot, inputName);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");

    await mkdir(scenarioRoot, { recursive: true });
    await mkdir(inputDir, { recursive: true });
    await writeFile(
      path.join(inputDir, "setup.sh"),
      [
        "#!/usr/bin/env sh",
        "set -e",
        "printf 'fixture setup stdout\\n'",
        "printf 'fixture setup stderr\\n' >&2",
        "printf 'partial setup artifact\\n' > partial.txt",
        "exit 23",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(path.join(inputDir, "setup.sh"), 0o755);
    await writeFile(
      path.join(scenarioRoot, "setup-failure.yaml"),
      [
        "name: setup-failure",
        "description: Version behavior command should not run after setup failure.",
        `input: ${inputName}`,
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 0",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runMain(["fixtures"], { scenarioRoot, inputRoot, tempRoot: tmpRoot });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("setup-failure failed in ");
    expect(result.stdout).toContain("(0 passed, 1 failed in ");
    expect(result.stderr).toContain("failures for setup-failure:");
    expect(result.stderr).toContain("setup.sh failed with exit code 23");
    expect(result.stderr).toContain("fixture setup stdout");
    expect(result.stderr).toContain("fixture setup stderr");
    const workdir = result.stderr.match(/^workdir: (.+)$/m)?.[1];
    expect(workdir).toBeDefined();
    expect(await readFile(path.join(workdir ?? "", "partial.txt"), "utf8")).toContain("partial setup artifact");
  });

  test("a filter with no matching scenario names exits non-zero with a clear message", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-empty-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "only.yaml"),
      [
        "name: only-scenario",
        "description: Version behavior fixture used to prove filter errors.",
        "input: greenfield",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 0",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runMain(["fixtures", "--filter", "missing"], { scenarioRoot });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('no fixtures matched filter "missing"');
  });

  test("version-only scenarios must declare an explicit version behavior purpose", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-version-only-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "smoke.yaml"),
      "name: smoke\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );

    const result = await runMain(["fixtures"], { scenarioRoot });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("version-only fixture scenario");
    expect(result.stderr).toContain("must describe explicit version behavior");
  });
});

describe("bun agent:check regression CLI", () => {
  test("package script exposes bun agent:check", async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

    expect(pkg.scripts?.["agent:check"]).toBe("bun src/dev/cli.ts agent:check");
  });

  test("main dispatches the agent:check subcommand", async () => {
    const result = await runMain(["agent:check"], { changedFiles: ["docs/foo.md"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✓ 0 scenarios run\n");
    expect(result.stderr).toBe("");
  });

  test("docs-only changes skip scenarios and print the zero-run summary", async () => {
    const result = await runAgentCheckMain([], { changedFiles: ["docs/foo.md"] });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✓ 0 scenarios run\n");
    expect(result.stderr).toBe("");
  });

  test("agent:check uses fixture lockfile language metadata for TypeScript template changes", async () => {
    const tmpRoot = path.join(sandboxRoot, `cli-test-agent-check-template-${randomUUID()}`);
    createdTargets.add(tmpRoot);

    const result = await runAgentCheckMain([], {
      changedFiles: ["src/templates/typescript/Makefile.ejs"],
      tempRoot: tmpRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✓ 10 scenarios passed\n");
    expect(result.stderr).toBe("");
  }, 180_000);

  test("agent:check reads git diff HEAD, runs only selected passing scenarios, and stays quiet on green", async () => {
    const root = path.join(sandboxRoot, `cli-test-agent-check-git-${randomUUID()}`);
    createdTargets.add(root);
    const gitRoot = path.join(root, "repo");
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");
    await mkdir(path.join(gitRoot, "tests", "fixtures", "inputs", "greenfield"), { recursive: true });
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(path.join(gitRoot, "tests", "fixtures", "inputs", "greenfield", "README.md"), "before\n", "utf8");
    await writeFile(
      path.join(scenarioRoot, "selected.yaml"),
      [
        "name: selected-agent-check",
        "description: Version behavior fixture used to prove agent:check selection.",
        "input: greenfield",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 0",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(scenarioRoot, "control.yaml"),
      [
        "name: control-agent-check",
        "description: Version behavior fixture used to prove agent:check selection.",
        "input: monorepo",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 99",
        "",
      ].join("\n"),
      "utf8",
    );
    await runGit(["init", "-q"], gitRoot);
    await runGit(["add", "tests/fixtures/inputs/greenfield/README.md"], gitRoot);
    await runGit(["-c", "user.name=Anvil Test", "-c", "user.email=anvil@example.test", "commit", "-qm", "seed"], gitRoot);
    await writeFile(path.join(gitRoot, "tests", "fixtures", "inputs", "greenfield", "README.md"), "after\n", "utf8");
    await runGit(["add", "tests/fixtures/inputs/greenfield/README.md"], gitRoot);

    const result = await runAgentCheckMain([], { repoRoot: gitRoot, scenarioRoot, tempRoot: tmpRoot });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✓ 1 scenarios passed\n");
    expect(result.stdout).not.toContain("passed in");
    expect(result.stdout).not.toContain("control-agent-check");
    expect(result.stderr).toBe("");
  });

  test("agent:check reports selected scenario failures with preserved workdirs", async () => {
    const root = path.join(sandboxRoot, `cli-test-agent-check-broken-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "broken.yaml"),
      [
        "name: broken-agent-check",
        "description: Version behavior fixture with an intentionally wrong assertion.",
        "input: greenfield",
        "args:",
        "  - --version",
        "expect:",
        "  exit_code: 99",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runAgentCheckMain([], {
      scenarioRoot,
      changedFiles: ["tests/fixtures/inputs/greenfield/.gitkeep"],
      tempRoot: tmpRoot,
    });

    expect(result.exitCode).toBe(1);
    const lines = outputLines(result.stdout);
    expect(lines.some((line) => line.includes(" broken-agent-check failed in "))).toBe(true);
    expect(lines.at(-1)).toContain("(0 passed, 1 failed in ");
    expect(result.stderr).toContain("failures for broken-agent-check:");
    expect(result.stderr).toContain("exit_code: expected 99, got 0");
    const workdir = result.stderr.match(/^workdir: (.+)$/m)?.[1];
    expect(workdir).toBeDefined();
    expect(await pathExists(workdir ?? "")).toBe(true);
  });
});
