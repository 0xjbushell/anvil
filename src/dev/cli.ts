import { spawn } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";

import { runScenario } from "./harness.ts";
import { selectRelevantScenarios } from "./changed.ts";
import { parseScenario, type Scenario } from "./schema.ts";

interface ParsedArgs {
  scenarioName: string;
  keep: boolean;
  name?: string;
}

interface FixturesArgs {
  filter?: string;
}

interface FixtureScenario {
  name: string;
  input: string;
  inputLanguage?: string;
  yamlPath: string;
}

interface FixtureRunOutcome {
  name: string;
  passed: boolean;
  failures: string[];
  duration_ms: number;
  workdir?: string;
}

interface WritableLike {
  write(chunk: string | Uint8Array): unknown;
}

export interface DevCliIo {
  stdout: WritableLike;
  stderr: WritableLike;
}

export interface DevCliRoots {
  repoRoot?: string;
  scenarioRoot?: string;
  inputRoot?: string;
  sandboxRoot?: string;
}

export interface AgentCheckOptions extends DevCliRoots {
  changedFiles?: readonly string[];
}

export interface PrepareDevSandboxOptions extends DevCliRoots {
  scenarioName: string;
  keep?: boolean;
  name?: string;
}

export interface PrepareDevSandboxResult {
  scenario: Scenario;
  inputPath: string;
  targetPath: string;
  hint: string;
}

interface ResolvedRoots {
  repoRoot: string;
  scenarioRoot: string;
  inputRoot: string;
  sandboxRoot: string;
}

const defaultRepoRoot = path.resolve(import.meta.dir, "..", "..");
const safeDirectoryNamePattern = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]*$/;

function usage(): string {
  return "usage: bun dev <scenario-name> [--keep] [--name <dirname>]";
}

function fixturesUsage(): string {
  return "usage: bun fixtures [--filter <substring>]";
}

function agentCheckUsage(): string {
  return "usage: bun agent:check";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function oneLine(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRoots(roots: DevCliRoots): ResolvedRoots {
  const repoRoot = path.resolve(roots.repoRoot ?? defaultRepoRoot);
  return {
    repoRoot,
    scenarioRoot: path.resolve(roots.scenarioRoot ?? path.join(repoRoot, "tests", "fixtures", "scenarios")),
    inputRoot: path.resolve(roots.inputRoot ?? path.join(repoRoot, "tests", "fixtures", "inputs")),
    sandboxRoot: path.resolve(roots.sandboxRoot ?? path.join(repoRoot, ".sandbox")),
  };
}

function validateScenarioName(scenarioName: string): string {
  if (!safeDirectoryNamePattern.test(scenarioName)) {
    throw new Error(`unsafe scenario name ${JSON.stringify(scenarioName)}: use a scenario file stem, not a path`);
  }

  return scenarioName;
}

function validateTargetName(name: string): string {
  if (!safeDirectoryNamePattern.test(name)) {
    throw new Error(
      `unsafe --name ${JSON.stringify(name)}: use a simple directory name without absolute paths, "..", or path separators`,
    );
  }

  return name;
}

function resolveScenarioPath(scenarioName: string, scenarioRoot: string): string {
  const safeScenarioName = validateScenarioName(scenarioName);
  const scenarioPath = path.resolve(scenarioRoot, `${safeScenarioName}.yaml`);
  if (!isInside(scenarioRoot, scenarioPath)) {
    throw new Error(`scenario ${JSON.stringify(scenarioName)} resolves outside ${scenarioRoot}`);
  }

  return scenarioPath;
}

function formatScenarioParseError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => {
        const field = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `${field}: ${issue.message}`;
      })
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}

async function loadScenario(scenarioName: string, scenarioRoot: string): Promise<Scenario> {
  const scenarioPath = resolveScenarioPath(scenarioName, scenarioRoot);
  let contents: string;
  try {
    contents = await readFile(scenarioPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`scenario ${JSON.stringify(scenarioName)} not found at ${scenarioPath}`);
    }

    throw error;
  }

  try {
    return parseScenario(parseYaml(contents));
  } catch (error) {
    throw new Error(
      `invalid scenario ${JSON.stringify(scenarioName)} at ${scenarioPath}: ${oneLine(formatScenarioParseError(error))}`,
    );
  }
}

async function loadFixtureScenario(yamlPath: string): Promise<Scenario> {
  let contents: string;
  try {
    contents = await readFile(yamlPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`fixture scenario not found at ${yamlPath}`);
    }

    throw error;
  }

  try {
    return parseScenario(parseYaml(contents));
  } catch (error) {
    throw new Error(`invalid fixture scenario at ${yamlPath}: ${oneLine(formatScenarioParseError(error))}`);
  }
}

async function loadFixtureInputLanguage(input: string, inputRoot: string): Promise<string | undefined> {
  const inputDir = path.resolve(inputRoot, input);
  if (!isInside(inputRoot, inputDir)) {
    throw new Error(`input fixture ${JSON.stringify(input)} resolves outside ${inputRoot}`);
  }

  const lockfilePath = path.join(inputDir, ".anvil.lock");
  let contents: string;
  try {
    contents = await readFile(lockfilePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  try {
    const parsed = parseYaml(contents) as { lang?: unknown } | null;
    return typeof parsed?.lang === "string" ? parsed.lang : undefined;
  } catch (error) {
    throw new Error(`invalid fixture input lockfile at ${lockfilePath}: ${oneLine(formatScenarioParseError(error))}`);
  }
}

async function resolveInputDir(input: string, inputRoot: string): Promise<string> {
  const inputDir = path.resolve(inputRoot, input);
  if (!isInside(inputRoot, inputDir)) {
    throw new Error(`input fixture ${JSON.stringify(input)} resolves outside ${inputRoot}`);
  }

  try {
    const inputStat = await stat(inputDir);
    if (inputStat.isDirectory()) return inputDir;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`input fixture ${JSON.stringify(input)} not found at ${inputDir}`);
    }

    throw error;
  }

  throw new Error(`input fixture ${JSON.stringify(input)} is not a directory at ${inputDir}`);
}

async function assertSandboxRootSafe(sandboxRoot: string): Promise<void> {
  const sandboxStat = await lstat(sandboxRoot);
  if (sandboxStat.isSymbolicLink()) {
    throw new Error(`sandbox root ${sandboxRoot} is a symlink; refusing to copy outside the repository sandbox`);
  }
  if (!sandboxStat.isDirectory()) {
    throw new Error(`sandbox root ${sandboxRoot} is not a directory`);
  }
}

async function assertNoSymlinks(targetPath: string, rootPath = targetPath): Promise<void> {
  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`sandbox target contains symlink ${path.relative(rootPath, entryPath)}; refusing --keep overlay`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(entryPath, rootPath);
    }
  }
}

async function assertKeepTargetSafe(targetPath: string): Promise<void> {
  let targetStat;
  try {
    targetStat = await lstat(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }

  if (targetStat.isSymbolicLink()) {
    throw new Error(`sandbox target ${targetPath} is a symlink; refusing --keep overlay`);
  }
  if (!targetStat.isDirectory()) {
    throw new Error(`sandbox target ${targetPath} exists and is not a directory`);
  }

  await assertNoSymlinks(targetPath);
}

function shellQuoteForHint(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildHint(repoRoot: string, targetPath: string, scenario: Scenario): string {
  const anvilEntrypoint = path.join(repoRoot, "bin", "anvil.ts");
  const relativeEntrypoint = path.relative(targetPath, anvilEntrypoint).split(path.sep).join("/");
  const scenarioArgs = scenario.args ?? scenario.pty?.command ?? [];
  const command = ["bun", relativeEntrypoint, ...scenarioArgs].map(shellQuoteForHint).join(" ");
  return `→ cd ${shellQuoteForHint(targetPath)} && ${command}`;
}

export function parseDevArgs(argv: string[]): ParsedArgs {
  let scenarioName: string | undefined;
  let keep = false;
  let name: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--keep") {
      keep = true;
      continue;
    }

    if (arg === "--name") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`missing value for --name\n${usage()}`);
      }
      name = value;
      index++;
      continue;
    }

    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}\n${usage()}`);
    }

    if (scenarioName !== undefined) {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}\n${usage()}`);
    }

    scenarioName = arg;
  }

  if (scenarioName === undefined) {
    throw new Error(`missing scenario name\n${usage()}`);
  }

  return { scenarioName, keep, name };
}

export function parseFixturesArgs(argv: string[]): FixturesArgs {
  let filter: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--filter") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`missing value for --filter\n${fixturesUsage()}`);
      }
      filter = value;
      index++;
      continue;
    }

    if (arg.startsWith("--filter=")) {
      filter = arg.slice("--filter=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}\n${fixturesUsage()}`);
    }

    throw new Error(`unexpected argument ${JSON.stringify(arg)}\n${fixturesUsage()}`);
  }

  return { filter };
}

export function parseAgentCheckArgs(argv: string[]): void {
  for (const arg of argv) {
    if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}\n${agentCheckUsage()}`);
    }

    throw new Error(`unexpected argument ${JSON.stringify(arg)}\n${agentCheckUsage()}`);
  }
}

export async function prepareDevSandbox(options: PrepareDevSandboxOptions): Promise<PrepareDevSandboxResult> {
  const roots = resolveRoots(options);
  const targetName = validateTargetName(options.name ?? "scratch");
  const targetPath = path.resolve(roots.sandboxRoot, targetName);
  if (!isInside(roots.sandboxRoot, targetPath)) {
    throw new Error(`sandbox target ${JSON.stringify(targetName)} resolves outside ${roots.sandboxRoot}`);
  }

  const scenario = await loadScenario(options.scenarioName, roots.scenarioRoot);
  const inputPath = await resolveInputDir(scenario.input, roots.inputRoot);

  await mkdir(roots.sandboxRoot, { recursive: true });
  await assertSandboxRootSafe(roots.sandboxRoot);
  if (!options.keep) {
    await rm(targetPath, { recursive: true, force: true });
  } else {
    await assertKeepTargetSafe(targetPath);
  }
  await cp(inputPath, targetPath, { recursive: true, force: true, preserveTimestamps: true });

  return {
    scenario,
    inputPath,
    targetPath,
    hint: buildHint(roots.repoRoot, targetPath, scenario),
  };
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

async function discoverFixtureScenarios(scenarioRoot: string, inputRoot?: string): Promise<FixtureScenario[]> {
  let entries;
  try {
    entries = await readdir(scenarioRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`fixture scenario root not found at ${scenarioRoot}`);
    }

    throw error;
  }

  const scenarioFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort();

  const scenarios: FixtureScenario[] = [];
  for (const scenarioFile of scenarioFiles) {
    const yamlPath = path.resolve(scenarioRoot, scenarioFile);
    if (!isInside(scenarioRoot, yamlPath)) {
      throw new Error(`fixture scenario ${JSON.stringify(scenarioFile)} resolves outside ${scenarioRoot}`);
    }

    const scenario = await loadFixtureScenario(yamlPath);
    scenarios.push({
      name: scenario.name,
      input: scenario.input,
      inputLanguage: inputRoot === undefined ? undefined : await loadFixtureInputLanguage(scenario.input, inputRoot),
      yamlPath,
    });
  }

  return scenarios;
}

async function runFixtureScenario(scenario: FixtureScenario): Promise<FixtureRunOutcome> {
  const started = performance.now();

  try {
    const result = await runScenario(scenario.yamlPath);
    return {
      name: result.scenario,
      passed: result.passed,
      failures: result.failures,
      duration_ms: result.duration_ms,
      workdir: result.workdir,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: scenario.name,
      passed: false,
      failures: [oneLine(message)],
      duration_ms: Math.round(performance.now() - started),
    };
  }
}

function writeFixtureFailure(io: DevCliIo, outcome: FixtureRunOutcome): void {
  io.stderr.write(`failures for ${outcome.name}:\n`);
  if (outcome.failures.length === 0) {
    io.stderr.write("  - scenario failed without detailed failures\n");
  } else {
    for (const failure of outcome.failures) {
      io.stderr.write(`  - ${failure}\n`);
    }
  }
  if (outcome.workdir !== undefined) {
    io.stderr.write(`workdir: ${outcome.workdir}\n`);
  }
}

function writeFixtureOutcomeLine(io: DevCliIo, outcome: FixtureRunOutcome): void {
  if (outcome.passed) {
    io.stdout.write(chalk.green(`✓ ${outcome.name} passed in ${formatDuration(outcome.duration_ms)}`) + "\n");
  } else {
    io.stdout.write(chalk.red(`✗ ${outcome.name} failed in ${formatDuration(outcome.duration_ms)}`) + "\n");
  }
}

function countOutcomes(outcomes: readonly FixtureRunOutcome[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.passed) {
      passed++;
    } else {
      failed++;
    }
  }

  return { passed, failed };
}

function writeFixtureSummary(io: DevCliIo, passed: number, failed: number, durationMs: number): void {
  const summary = `(${passed} passed, ${failed} failed in ${formatDuration(durationMs)})`;
  io.stdout.write((failed === 0 ? chalk.green(summary) : chalk.red(summary)) + "\n");
}

function gitDiffNameOnly(repoRoot: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--name-only", "HEAD"], {
      cwd: repoRoot,
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
    child.on("error", (error) => {
      reject(new Error(`failed to run git diff --name-only HEAD: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.split(/\r?\n/).filter((line) => line.length > 0));
        return;
      }

      const detail = oneLine(stderr || stdout || `exit code ${code ?? 1}`);
      reject(new Error(`git diff --name-only HEAD failed: ${detail}`));
    });
  });
}

export async function runFixtures(
  argv: string[],
  io: DevCliIo = { stdout: process.stdout, stderr: process.stderr },
  roots: DevCliRoots = {},
): Promise<number> {
  try {
    const args = parseFixturesArgs(argv);
    const resolvedRoots = resolveRoots(roots);
    const discovered = await discoverFixtureScenarios(resolvedRoots.scenarioRoot);
    if (discovered.length === 0) {
      io.stderr.write(`error: no fixture scenarios found in ${resolvedRoots.scenarioRoot}\n`);
      return 1;
    }

    const selected =
      args.filter === undefined ? discovered : discovered.filter((scenario) => scenario.name.includes(args.filter ?? ""));
    if (selected.length === 0) {
      io.stderr.write(`error: no fixtures matched filter ${JSON.stringify(args.filter)}\n`);
      return 1;
    }

    const started = performance.now();
    let passed = 0;
    let failed = 0;

    for (const scenario of selected) {
      const outcome = await runFixtureScenario(scenario);
      if (outcome.passed) {
        passed++;
        writeFixtureOutcomeLine(io, outcome);
      } else {
        failed++;
        writeFixtureOutcomeLine(io, outcome);
        writeFixtureFailure(io, outcome);
      }
    }

    writeFixtureSummary(io, passed, failed, Math.round(performance.now() - started));
    return failed === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`error: ${oneLine(message)}\n`);
    return 1;
  }
}

export async function runAgentCheck(
  argv: string[],
  io: DevCliIo = { stdout: process.stdout, stderr: process.stderr },
  options: AgentCheckOptions = {},
): Promise<number> {
  try {
    parseAgentCheckArgs(argv);
    const resolvedRoots = resolveRoots(options);
    const discovered = await discoverFixtureScenarios(resolvedRoots.scenarioRoot, resolvedRoots.inputRoot);
    if (discovered.length === 0) {
      io.stderr.write(`error: no fixture scenarios found in ${resolvedRoots.scenarioRoot}\n`);
      return 1;
    }

    const changedFiles = options.changedFiles ?? (await gitDiffNameOnly(resolvedRoots.repoRoot));
    const selected = selectRelevantScenarios(discovered, changedFiles);
    if (selected.length === 0) {
      io.stdout.write("✓ 0 scenarios run\n");
      return 0;
    }

    const started = performance.now();
    const outcomes: FixtureRunOutcome[] = [];
    for (const scenario of selected) {
      outcomes.push(await runFixtureScenario(scenario));
    }

    const { passed, failed } = countOutcomes(outcomes);
    if (failed === 0) {
      io.stdout.write(`✓ ${passed} scenarios passed\n`);
      return 0;
    }

    for (const outcome of outcomes) {
      writeFixtureOutcomeLine(io, outcome);
      if (!outcome.passed) {
        writeFixtureFailure(io, outcome);
      }
    }
    writeFixtureSummary(io, passed, failed, Math.round(performance.now() - started));

    return 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`error: ${oneLine(message)}\n`);
    return 1;
  }
}

export async function main(
  argv = process.argv.slice(2),
  io: DevCliIo = { stdout: process.stdout, stderr: process.stderr },
  roots: DevCliRoots = {},
): Promise<number> {
  if (argv[0] === "fixtures") {
    return runFixtures(argv.slice(1), io, roots);
  }
  if (argv[0] === "agent:check") {
    return runAgentCheck(argv.slice(1), io, roots);
  }

  try {
    const args = parseDevArgs(argv);
    const result = await prepareDevSandbox({ ...roots, ...args });
    io.stdout.write(`${result.targetPath}\n`);
    io.stderr.write(`${result.hint}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`error: ${oneLine(message)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const exitCode = await main();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
