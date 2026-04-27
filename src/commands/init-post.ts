import chalk from "chalk";
import { stat } from "node:fs/promises";
import path from "node:path";

import type { TextWriter } from "../scaffold/conflict-reporter.ts";
import type { ScaffoldContext } from "../types.ts";
import { commandText, describeError, writeLine } from "./init-utils.ts";

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: RunCommandOptions,
) => Promise<RunCommandResult>;
export type StatProbe = (filePath: string) => Promise<unknown>;

export interface PostScaffoldDependencies {
  stderr: TextWriter;
  runCommand: CommandRunner;
  stat?: StatProbe;
}

type PathStatus = "exists" | "missing" | "unknown";

async function pathStatus(filePath: string, label: string, deps: PostScaffoldDependencies): Promise<PathStatus> {
  try {
    await (deps.stat ?? stat)(filePath);
    return "exists";
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    writeLine(
      deps.stderr,
      chalk.yellow(`warning: could not inspect ${label} (${describeError(error)}). Git hooks skipped.`),
    );
    return "unknown";
  }
}

async function runBestEffort(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  manualCommand: string,
  deps: PostScaffoldDependencies,
): Promise<boolean> {
  try {
    const result = await deps.runCommand(command, args, { cwd });
    if (result.exitCode === 0) {
      return true;
    }

    writeLine(
      deps.stderr,
      chalk.yellow(
        `warning: ${label} failed (${commandText(command, args)} exited ${result.exitCode}). Run manually: ${manualCommand}`,
      ),
    );
    return false;
  } catch (error) {
    writeLine(
      deps.stderr,
      chalk.yellow(`warning: ${label} failed (${describeError(error)}). Run manually: ${manualCommand}`),
    );
    return false;
  }
}

async function commandAvailable(
  command: string,
  cwd: string,
  unavailableWarning: string,
  deps: PostScaffoldDependencies,
): Promise<boolean> {
  try {
    return (await deps.runCommand(command, ["--version"], { cwd })).exitCode === 0;
  } catch (error) {
    writeLine(
      deps.stderr,
      chalk.yellow(
        `warning: could not check ${command} availability (${describeError(error)}). ${unavailableWarning}`,
      ),
    );
    return false;
  }
}

async function installProjectDependencies(
  ctx: ScaffoldContext,
  deps: PostScaffoldDependencies,
): Promise<void> {
  if (ctx.lang === "typescript" && ctx.packageManager !== undefined) {
    await runBestEffort(
      "package install",
      ctx.packageManager,
      ["install"],
      ctx.targetDir,
      `${ctx.packageManager} install`,
      deps,
    );
  }

  if (ctx.lang === "golang") {
    await runBestEffort("go mod tidy", "go", ["mod", "tidy"], ctx.targetDir, "go mod tidy", deps);
  }

  if (ctx.lang === "python") {
    await runBestEffort(
      "Python dev dependency install",
      "uv",
      ["pip", "install", "-e", ".[dev]"],
      ctx.targetDir,
      "uv pip install -e .[dev]",
      deps,
    );
  }
}

async function setupGitHooks(ctx: ScaffoldContext, deps: PostScaffoldDependencies): Promise<void> {
  if (
    !(await commandAvailable(
      "git",
      ctx.targetDir,
      "Git init and hooks skipped.",
      deps,
    ))
  ) {
    writeLine(deps.stderr, chalk.yellow("warning: git not installed - git init and hooks skipped."));
    return;
  }

  const gitDirStatus = await pathStatus(path.join(ctx.targetDir, ".git"), ".git directory", deps);
  if (gitDirStatus === "unknown") {
    return;
  }

  if (gitDirStatus === "missing") {
    const initialized = await runBestEffort("git init", "git", ["init"], ctx.targetDir, "git init", deps);
    if (!initialized) {
      return;
    }
  }

  if (
    !(await commandAvailable(
      "pre-commit",
      ctx.targetDir,
      "Hooks skipped. Install: pip install pre-commit",
      deps,
    ))
  ) {
    writeLine(
      deps.stderr,
      chalk.yellow("warning: pre-commit not installed - hooks skipped. Install: pip install pre-commit"),
    );
    return;
  }

  await runBestEffort(
    "pre-commit install",
    "pre-commit",
    ["install"],
    ctx.targetDir,
    "pre-commit install",
    deps,
  );
}

async function installPythonPlugin(ctx: ScaffoldContext, deps: PostScaffoldDependencies): Promise<void> {
  if (ctx.lang !== "python") {
    return;
  }

  await runBestEffort(
    "Python flake8 plugin install",
    "uv",
    ["pip", "install", "-e", "tools/flake8-plugin/"],
    ctx.targetDir,
    "uv pip install -e tools/flake8-plugin/",
    deps,
  );
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

export async function runPostScaffold(
  ctx: ScaffoldContext,
  deps: PostScaffoldDependencies,
): Promise<void> {
  await installProjectDependencies(ctx, deps);
  await setupGitHooks(ctx, deps);
  await installPythonPlugin(ctx, deps);
}
