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

async function withTmpDir<T>(tmpDir: string, action: () => Promise<T>): Promise<T> {
  const previousTmpDir = process.env.TMPDIR;
  process.env.TMPDIR = tmpDir;
  await mkdir(tmpDir, { recursive: true });

  try {
    return await action();
  } finally {
    if (previousTmpDir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousTmpDir;
    }
  }
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
  test("bun dev greenfield creates .sandbox/scratch matching the greenfield input and prints a hint", async () => {
    createdTargets.add(scratchTarget);

    const result = await runDev(["greenfield"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${scratchTarget}\n`);
    expect(result.stderr).toContain(`cd ${scratchTarget}`);
    expect(result.stderr).toContain("bin/anvil");
    await expectTargetMatchesInput(scratchTarget);
  });

  test("default runs wipe and recopy .sandbox/scratch", async () => {
    createdTargets.add(scratchTarget);

    expect((await runDev(["greenfield"])).exitCode).toBe(0);
    const extraFile = path.join(scratchTarget, "extra.txt");
    await writeFile(extraFile, "remove me\n", "utf8");
    expect(await pathExists(extraFile)).toBe(true);

    const result = await runDev(["greenfield"]);

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

    const result = await runDev(["greenfield", "--name", name]);

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

    const result = await runMain(["greenfield"], { sandboxRoot: root });

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
  }, 30_000);

  test("--filter runs only scenarios whose parsed names contain the substring", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-filter-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "selected.yaml"),
      "name: alpha-drift\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );
    await writeFile(
      path.join(scenarioRoot, "control.yaml"),
      "name: beta-clean\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );

    const result = await withTmpDir(tmpRoot, () => runMain(["fixtures", "--filter", "drift"], { scenarioRoot }));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const lines = outputLines(result.stdout);
    const passLines = lines.filter((line) => line.includes(" passed in "));
    expect(passLines).toHaveLength(1);
    expect(passLines[0]).toContain(" alpha-drift passed in ");
    expect(result.stdout).not.toContain("beta-clean");
    expect(lines.at(-1)).toContain("(1 passed, 0 failed in ");
  });

  test("a broken scenario exits non-zero and reports failures with the preserved workdir", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-broken-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    const tmpRoot = path.join(root, "tmp");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "broken.yaml"),
      "name: broken-fixture\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 99\n",
      "utf8",
    );

    const result = await withTmpDir(tmpRoot, () => runMain(["fixtures"], { scenarioRoot }));

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

  test("a filter with no matching scenario names exits non-zero with a clear message", async () => {
    const root = path.join(sandboxRoot, `cli-test-fixtures-empty-${randomUUID()}`);
    createdTargets.add(root);
    const scenarioRoot = path.join(root, "scenarios");
    await mkdir(scenarioRoot, { recursive: true });
    await writeFile(
      path.join(scenarioRoot, "only.yaml"),
      "name: only-scenario\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );

    const result = await runMain(["fixtures", "--filter", "missing"], { scenarioRoot });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('no fixtures matched filter "missing"');
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

    const result = await withTmpDir(tmpRoot, () =>
      runAgentCheckMain([], { changedFiles: ["templates/typescript/Makefile.ejs"] }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("✓ 3 scenarios passed\n");
    expect(result.stderr).toBe("");
  });

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
      "name: selected-agent-check\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 0\n",
      "utf8",
    );
    await writeFile(
      path.join(scenarioRoot, "control.yaml"),
      "name: control-agent-check\ninput: monorepo\nargs:\n  - --version\nexpect:\n  exit_code: 99\n",
      "utf8",
    );
    await runGit(["init", "-q"], gitRoot);
    await runGit(["add", "tests/fixtures/inputs/greenfield/README.md"], gitRoot);
    await runGit(["-c", "user.name=Anvil Test", "-c", "user.email=anvil@example.test", "commit", "-qm", "seed"], gitRoot);
    await writeFile(path.join(gitRoot, "tests", "fixtures", "inputs", "greenfield", "README.md"), "after\n", "utf8");
    await runGit(["add", "tests/fixtures/inputs/greenfield/README.md"], gitRoot);

    const result = await withTmpDir(tmpRoot, () => runAgentCheckMain([], { repoRoot: gitRoot, scenarioRoot }));

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
      "name: broken-agent-check\ninput: greenfield\nargs:\n  - --version\nexpect:\n  exit_code: 99\n",
      "utf8",
    );

    const result = await withTmpDir(tmpRoot, () =>
      runAgentCheckMain([], {
        scenarioRoot,
        changedFiles: ["tests/fixtures/inputs/greenfield/.gitkeep"],
      }),
    );

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
