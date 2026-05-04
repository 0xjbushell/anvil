import chalk from "chalk";
import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import pkg from "../../package.json" with { type: "json" };
import {
  contextFromAnswers,
  defaultPrompts,
  resolveAnswers,
  resolveToolchainVersions,
  type Fetcher,
  type PromptAdapter,
  type ToolchainResolution,
} from "./init-context.ts";
import {
  runCommand,
  runPostScaffold,
  type CommandRunner,
  type RunCommandOptions,
  type RunCommandResult,
  type StatProbe,
} from "./init-post.ts";
import { describeError, writeLine } from "./init-utils.ts";
import { createInteractiveConflictHandler } from "../scaffold/conflict.ts";
import { createConflictReporter, type TextWriter } from "../scaffold/conflict-reporter.ts";
import { acquire } from "../scaffold/dirlock.ts";
import { detectProject } from "../scaffold/detect.ts";
import {
  IncompleteLockfileError,
  ScaffoldConflictError,
  previewScaffold,
  scaffold,
  type ScaffoldOptions,
  type ScaffoldPreviewResult,
  type ScaffoldResult,
} from "../scaffold/engine.ts";
import { readLockfile, refreshLockfileChecksums } from "../scaffold/lockfile.ts";
import type { AnvilLockfile, Lang, ScaffoldContext } from "../types.ts";

export type { CommandRunner, RunCommandOptions, RunCommandResult, ToolchainResolution };

export interface InitOptions {
  lang: Lang;
  nonInteractive?: boolean;
  dryRun?: boolean;
}

export interface InitResult {
  exitCode: 0 | 1;
}

export interface InitDependencies {
  cwd?: () => string;
  stdin?: { isTTY?: boolean };
  stdout?: TextWriter;
  stderr?: TextWriter;
  prompts?: PromptAdapter;
  acquire?: typeof acquire;
  detectProject?: typeof detectProject;
  readLockfile?: typeof readLockfile;
  scaffold?: typeof scaffold;
  previewScaffold?: typeof previewScaffold;
  createInteractiveConflictHandler?: typeof createInteractiveConflictHandler;
  createConflictReporter?: typeof createConflictReporter;
  resolveToolchain?: (lang: Lang, lockfile: AnvilLockfile | null) => Promise<ToolchainResolution>;
  runCommand?: CommandRunner;
  anvilVersion?: string;
  now?: () => Date;
  mkdir?: typeof mkdir;
  realpath?: typeof realpath;
  stat?: StatProbe;
  fetch?: Fetcher;
}

interface ResolvedInitDependencies {
  cwd: () => string;
  stdin: { isTTY?: boolean };
  stdout: TextWriter;
  stderr: TextWriter;
  prompts: PromptAdapter;
  acquire: typeof acquire;
  detectProject: typeof detectProject;
  readLockfile: typeof readLockfile;
  scaffold: typeof scaffold;
  previewScaffold: typeof previewScaffold;
  createInteractiveConflictHandler: typeof createInteractiveConflictHandler;
  createConflictReporter: typeof createConflictReporter;
  resolveToolchain?: (lang: Lang, lockfile: AnvilLockfile | null) => Promise<ToolchainResolution>;
  runCommand: CommandRunner;
  anvilVersion: string;
  now: () => Date;
  mkdir: typeof mkdir;
  realpath: typeof realpath;
  stat: StatProbe;
  fetch: Fetcher;
}

type ExistingLockfileRead =
  | { result: InitResult; lockfile: null }
  | { result: null; lockfile: AnvilLockfile | null };

function resolveDependencies(deps: InitDependencies): ResolvedInitDependencies {
  return {
    cwd: deps.cwd ?? (() => process.cwd()),
    stdin: deps.stdin ?? process.stdin,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    prompts: deps.prompts ?? defaultPrompts(),
    acquire: deps.acquire ?? acquire,
    detectProject: deps.detectProject ?? detectProject,
    readLockfile: deps.readLockfile ?? readLockfile,
    scaffold: deps.scaffold ?? scaffold,
    previewScaffold: deps.previewScaffold ?? previewScaffold,
    createInteractiveConflictHandler: deps.createInteractiveConflictHandler ?? createInteractiveConflictHandler,
    createConflictReporter: deps.createConflictReporter ?? createConflictReporter,
    resolveToolchain: deps.resolveToolchain,
    runCommand: deps.runCommand ?? runCommand,
    anvilVersion: deps.anvilVersion ?? pkg.version,
    now: deps.now ?? (() => new Date()),
    mkdir: deps.mkdir ?? mkdir,
    realpath: deps.realpath ?? realpath,
    stat: deps.stat ?? stat,
    fetch: deps.fetch ?? globalThis.fetch,
  };
}

function fail(stderr: TextWriter, message: string): InitResult {
  writeLine(stderr, chalk.red(message));
  return { exitCode: 1 };
}

function success(): InitResult {
  return { exitCode: 0 };
}

async function canonicalTargetDir(deps: ResolvedInitDependencies): Promise<string> {
  const resolved = path.resolve(deps.cwd());
  await deps.mkdir(resolved, { recursive: true });
  return deps.realpath(resolved);
}

function lockfileFromResult(
  result: Awaited<ReturnType<typeof readLockfile>>,
): AnvilLockfile | null {
  if (result.status === "complete" || result.status === "in-progress") {
    return result.lockfile;
  }

  return null;
}

async function readExistingLockfile(
  targetDir: string,
  lang: Lang,
  nonInteractive: boolean,
  deps: ResolvedInitDependencies,
): Promise<ExistingLockfileRead> {
  const lockfileResult = await deps.readLockfile(targetDir);

  if (lockfileResult.status === "corrupt") {
    return {
      result: fail(
        deps.stderr,
        `error: Cannot read .anvil.lock: ${describeError(
          lockfileResult.error,
        )}. Delete .anvil.lock and re-run anvil init to rebuild it.`,
      ),
      lockfile: null,
    };
  }

  const lockfile = lockfileFromResult(lockfileResult);
  if (lockfile === null) {
    return { result: null, lockfile: null };
  }

  if (lockfile.lang !== lang) {
    return {
      result: fail(
        deps.stderr,
        `error: This project was scaffolded for ${lockfile.lang}. Cross-language migration is not supported in v1. Use a separate directory or delete .anvil.lock to start fresh.`,
      ),
      lockfile: null,
    };
  }

  if (lockfileResult.status !== "in-progress") {
    return { result: null, lockfile };
  }

  return handleInterruptedLockfile(lockfile, nonInteractive, deps);
}

async function handleInterruptedLockfile(
  lockfile: AnvilLockfile,
  nonInteractive: boolean,
  deps: ResolvedInitDependencies,
): Promise<ExistingLockfileRead> {
  if (nonInteractive) {
    return {
      result: fail(
        deps.stderr,
        "error: Previous init was interrupted. Re-run interactively to resume, or run 'anvil doctor' for details.",
      ),
      lockfile: null,
    };
  }

  const resume = await deps.prompts.confirm({
    message: "Previous init was interrupted. Resume?",
    default: true,
  });
  if (!resume) {
    writeLine(
      deps.stdout,
      "Aborted. Re-run 'anvil init' to start fresh, or 'anvil doctor' for details.",
    );
    return { result: success(), lockfile: null };
  }

  return { result: null, lockfile };
}

function scaffoldOptions(ctx: ScaffoldContext, deps: ResolvedInitDependencies): ScaffoldOptions {
  if (ctx.nonInteractive) {
    return { onReport: deps.createConflictReporter(deps.stderr) };
  }

  return { onConflict: deps.createInteractiveConflictHandler() };
}

function seedPath(lang: Lang): string {
  return lang === "golang" ? "internal/seed/" : "src/seed/";
}

function seedWasCreated(ctx: ScaffoldContext, result: ScaffoldResult): boolean {
  const prefix = seedPath(ctx.lang);
  return !ctx.skipSeed && result.filesCreated.some((filePath) => filePath.startsWith(prefix));
}

function printSummary(ctx: ScaffoldContext, result: ScaffoldResult, stdout: TextWriter): void {
  writeLine(stdout, `Scaffolded ${ctx.lang} project "${ctx.projectName}"`);
  writeLine(stdout);
  writeLine(stdout, `Files created: ${result.filesCreated.length}`);
  writeLine(stdout, `Files skipped: ${result.filesSkipped.length}`);

  if (seedWasCreated(ctx, result)) {
    writeLine(stdout);
    writeLine(stdout, `Seed code created at ${seedPath(ctx.lang)}`);
    writeLine(stdout, "Use it as a reference for project conventions.");
  }
}

function countChanges(preview: ScaffoldPreviewResult, action: "create" | "update" | "unchanged"): number {
  return preview.changes.filter((change) => change.action === action).length;
}

function printDryRun(preview: ScaffoldPreviewResult, stdout: TextWriter): void {
  writeLine(stdout, "Dry run: no files written.");
  writeLine(stdout, `Files to create: ${countChanges(preview, "create")}`);
  writeLine(stdout, `Files to update: ${countChanges(preview, "update")}`);
  writeLine(stdout, `Files unchanged: ${countChanges(preview, "unchanged")}`);
  writeLine(stdout, `Files skipped: ${preview.filesSkipped.length}`);
}

async function executeScaffold(ctx: ScaffoldContext, deps: ResolvedInitDependencies): Promise<InitResult> {
  try {
    const result = await deps.scaffold(ctx, scaffoldOptions(ctx, deps));
    await runPostScaffold(ctx, deps);
    if (ctx.lang === "golang" && result.filesCreated.includes("go.mod")) {
      await refreshLockfileChecksums(ctx.targetDir, result.lockfile, ["go.mod"]);
    }
    printSummary(ctx, result, deps.stdout);
    return success();
  } catch (error) {
    if (error instanceof ScaffoldConflictError) {
      return { exitCode: 1 };
    }

    if (error instanceof IncompleteLockfileError) {
      return fail(deps.stderr, `error: ${error.message}`);
    }

    return fail(deps.stderr, `error: ${describeError(error)}`);
  }
}

async function executeDryRun(ctx: ScaffoldContext, deps: ResolvedInitDependencies): Promise<InitResult> {
  try {
    printDryRun(await deps.previewScaffold(ctx), deps.stdout);
    return success();
  } catch (error) {
    return fail(deps.stderr, `error: ${describeError(error)}`);
  }
}

async function resolveToolchain(
  lang: Lang,
  lockfile: AnvilLockfile | null,
  deps: ResolvedInitDependencies,
): Promise<ToolchainResolution> {
  if (lockfile !== null) {
    return { toolchain: { ...lockfile.toolchain }, warnings: [] };
  }

  if (deps.resolveToolchain !== undefined) {
    return deps.resolveToolchain(lang, null);
  }

  return resolveToolchainVersions(lang, null, {
    runCommand: deps.runCommand,
    fetch: deps.fetch,
    anvilVersion: deps.anvilVersion,
    now: deps.now,
  });
}

async function runLocked(
  targetDir: string,
  options: InitOptions,
  nonInteractive: boolean,
  deps: ResolvedInitDependencies,
): Promise<InitResult> {
  const lockfileRead = await readExistingLockfile(targetDir, options.lang, nonInteractive, deps);
  if (lockfileRead.result !== null) {
    return lockfileRead.result;
  }

  const detection = await deps.detectProject(targetDir, options.lang);
  const answers = await resolveAnswers(targetDir, options.lang, nonInteractive, lockfileRead.lockfile, detection, deps);
  if (answers === null) {
    writeLine(deps.stdout, "Aborted.");
    return success();
  }

  const resolution = await resolveToolchain(options.lang, lockfileRead.lockfile, deps);
  for (const warning of resolution.warnings) {
    writeLine(deps.stderr, chalk.yellow(warning));
  }

  const ctx = contextFromAnswers(
    targetDir,
    options.lang,
    nonInteractive,
    answers,
    detection,
    resolution.toolchain,
    deps.anvilVersion,
  );

  return options.dryRun === true ? executeDryRun(ctx, deps) : executeScaffold(ctx, deps);
}

export default async function init(options: InitOptions, injectedDeps: InitDependencies = {}): Promise<InitResult> {
  const deps = resolveDependencies(injectedDeps);
  const nonInteractive = options.nonInteractive === true;

  if (!nonInteractive && deps.stdin.isTTY !== true) {
    return fail(
      deps.stderr,
      "error: anvil init requires a TTY for interactive prompts; pass --non-interactive to run headless",
    );
  }

  const targetDir = options.dryRun === true ? path.resolve(deps.cwd()) : await canonicalTargetDir(deps);

  if (options.dryRun === true) {
    return runLocked(targetDir, options, nonInteractive, deps);
  }

  const dirLock = await deps.acquire(targetDir);
  try {
    return await runLocked(targetDir, options, nonInteractive, deps);
  } finally {
    await dirLock.release();
  }
}
