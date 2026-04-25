import { cp, lstat, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";

import { parseScenario, type Scenario } from "./schema.ts";

interface ParsedArgs {
  scenarioName: string;
  keep: boolean;
  name?: string;
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

export async function main(
  argv = process.argv.slice(2),
  io: DevCliIo = { stdout: process.stdout, stderr: process.stderr },
  roots: DevCliRoots = {},
): Promise<number> {
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
