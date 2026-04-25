import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { compare } from "../internal/dir-compare/index.ts";
import { main } from "./cli.ts";

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
  scenarioRoot?: string;
  inputRoot?: string;
  sandboxRoot?: string;
}

class StringWriter {
  text = "";

  write(chunk: string | Uint8Array): boolean {
    this.text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }
}

function runDev(args: string[]): Promise<DevRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(bunExecutable, ["dev", ...args], {
      cwd: repoRoot,
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
