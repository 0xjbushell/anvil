import { confirm, input, select } from "@inquirer/prompts";
import path from "node:path";

import { loadToolchainDefaults } from "../internal/toolchain-defaults.ts";
import type { TextWriter } from "../scaffold/conflict-reporter.ts";
import type { DetectionResult } from "../scaffold/detect.ts";
import type { AnvilLockfile, Lang, PackageManager, ScaffoldContext, ToolchainVersions } from "../types.ts";
import type { CommandRunner, RunCommandResult } from "./init-post.ts";

export interface ToolchainResolution {
  toolchain: ToolchainVersions;
  warnings: string[];
}

export type Fetcher = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>;

export interface ToolchainResolverDependencies {
  runCommand?: CommandRunner;
  fetch?: Fetcher;
  fetchTimeoutMs?: number;
  anvilVersion?: string;
  now?: () => Date;
}

type InputPrompt = (config: {
  message: string;
  default?: string;
  validate?: (value: string) => true | string;
}) => Promise<string>;
type ConfirmPrompt = (config: { message: string; default?: boolean }) => Promise<boolean>;
type SelectPrompt = (config: {
  message: string;
  choices: ReadonlyArray<{ name: string; value: PackageManager }>;
  default?: PackageManager;
}) => Promise<PackageManager>;

export interface PromptAdapter {
  input: InputPrompt;
  confirm: ConfirmPrompt;
  select: SelectPrompt;
}

interface InitAnswers {
  projectName: string;
  defaultBranch: string;
  skipSeed: boolean;
  sourceDir?: string;
  packageManager?: PackageManager;
  year: number;
}

export interface AnswerDependencies {
  prompts: PromptAdapter;
  runCommand: CommandRunner;
  stderr: TextWriter;
  now: () => Date;
}

const packageManagers: PackageManager[] = ["bun", "npm", "pnpm", "yarn"];
const projectNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const toolchainFetchTimeoutMs = 10_000;

export function defaultPrompts(): PromptAdapter {
  return {
    input: (config) => input(config),
    confirm: (config) => confirm(config),
    select: (config) => select(config),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandText(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function writeLine(writer: TextWriter, line: string): void {
  writer.write(`${line}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeVersion(value: string, prefix: RegExp): string {
  const version = value.trim().replace(prefix, "");
  if (!semverPattern.test(version)) {
    throw new TypeError(`resolved toolchain version ${JSON.stringify(value)} is not semver-shaped`);
  }

  return version;
}

function requireRecord(value: unknown, source: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new TypeError(`${source} response entry must be an object`);
}

function requireArray(value: unknown, source: string): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new TypeError(`${source} response must be a JSON array`);
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  url: string,
  source: string,
  timeoutMs: number,
  readResponse: (response: Response) => Promise<unknown>,
  init: Parameters<typeof fetch>[1] = {},
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`${source} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const request = fetcher(url, { ...init, signal: controller.signal });

  try {
    return await Promise.race([request.then(readResponse), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

async function fetchJson(fetcher: Fetcher, url: string, source: string, timeoutMs: number): Promise<unknown> {
  return fetchWithTimeout(fetcher, url, source, timeoutMs, (response) => {
    if (!response.ok) {
      throw new Error(`${source} returned HTTP ${response.status}`);
    }

    return response.json();
  });
}

async function fetchLatestNode(fetcher: Fetcher, timeoutMs: number): Promise<string> {
  const entries = requireArray(
    await fetchJson(fetcher, "https://nodejs.org/dist/index.json", "nodejs.org", timeoutMs),
    "nodejs.org",
  );
  const candidate = entries.map((entry) => requireRecord(entry, "nodejs.org")).find((entry) => entry.lts !== false);
  if (typeof candidate?.version !== "string") {
    throw new Error("nodejs.org response did not include an LTS version");
  }

  return normalizeVersion(candidate.version, /^v/);
}

async function fetchLatestGo(fetcher: Fetcher, timeoutMs: number): Promise<string> {
  const entries = requireArray(await fetchJson(fetcher, "https://go.dev/dl/?mode=json", "go.dev", timeoutMs), "go.dev");
  const candidate = entries
    .map((entry) => requireRecord(entry, "go.dev"))
    .find((entry) => typeof entry.version === "string" && !/(?:beta|rc)/i.test(entry.version));
  if (typeof candidate?.version !== "string") {
    throw new Error("go.dev response did not include a stable version");
  }

  return normalizeVersion(candidate.version, /^go/);
}

async function fetchLatestPython(fetcher: Fetcher, now: Date, timeoutMs: number): Promise<string> {
  const today = now.toISOString().slice(0, 10);
  const entries = requireArray(
    await fetchJson(fetcher, "https://endoflife.date/api/python.json", "endoflife.date", timeoutMs),
    "endoflife.date",
  );
  const candidate = entries
    .map((entry) => requireRecord(entry, "endoflife.date"))
    .find((entry) => typeof entry.latest === "string" && typeof entry.eol === "string" && entry.eol > today);
  if (typeof candidate?.latest !== "string") {
    throw new Error("endoflife.date response did not include a supported Python version");
  }

  return normalizeVersion(candidate.latest, /^v/);
}

async function resolveLocalBun(runCommand: CommandRunner | undefined): Promise<string | null> {
  if (runCommand === undefined) {
    return null;
  }

  try {
    const result = await runCommand("bun", ["--version"], { cwd: process.cwd() });
    if (result.exitCode !== 0) {
      return null;
    }

    return normalizeVersion(result.stdout, /^v/);
  } catch {
    return null;
  }
}

async function fetchLatestBun(fetcher: Fetcher, timeoutMs: number): Promise<string> {
  const finalUrl = String(
    await fetchWithTimeout(
      fetcher,
      "https://github.com/oven-sh/bun/releases/latest",
      "github.com/oven-sh/bun",
      timeoutMs,
      async (response) => {
        if (!response.ok) {
          throw new Error(`github.com/oven-sh/bun returned HTTP ${response.status}`);
        }

        return response.url;
      },
      { redirect: "follow" },
    ),
  );
  const match = /(?:bun-)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(finalUrl);
  if (match?.[1] === undefined) {
    throw new Error("github.com/oven-sh/bun latest release URL did not include a version");
  }

  return normalizeVersion(match[1], /^v/);
}

async function resolveWithFallback(
  source: string,
  lang: string,
  fallbackVersion: string,
  anvilVersion: string,
  warnings: string[],
  resolve: () => Promise<string>,
): Promise<string> {
  try {
    return await resolve();
  } catch (error) {
    warnings.push(
      `warning: could not reach ${source} for latest ${lang} version (${describeError(
        error,
      )}); using bundled default ${fallbackVersion} from anvil ${anvilVersion}. Run online to refresh.`,
    );
    return fallbackVersion;
  }
}

function validateProjectName(value: string): true | string {
  return projectNamePattern.test(value) ? true : "Use lowercase npm package name characters with no spaces.";
}

async function runQuiet(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  stderr: TextWriter,
): Promise<RunCommandResult | null> {
  try {
    const result = await runner(command, args, { cwd });
    return result.exitCode === 0 ? result : null;
  } catch (error) {
    writeLine(
      stderr,
      `warning: could not run ${commandText(command, args)} while detecting the default branch (${describeError(
        error,
      )}); using the configured default.`,
    );
    return null;
  }
}

async function detectDefaultBranch(
  targetDir: string,
  runner: CommandRunner,
  stderr: TextWriter,
): Promise<string | undefined> {
  const remoteHead = await runQuiet(
    runner,
    "git",
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    targetDir,
    stderr,
  );
  const remote = remoteHead?.stdout.trim();
  if (remote) {
    return remote.includes("/") ? remote.slice(remote.lastIndexOf("/") + 1) : remote;
  }

  const configured = await runQuiet(
    runner,
    "git",
    ["config", "--get", "init.defaultBranch"],
    targetDir,
    stderr,
  );
  return configured?.stdout.trim() || undefined;
}

function lockedAnswers(lockfile: AnvilLockfile): InitAnswers {
  return {
    projectName: lockfile.context.projectName,
    defaultBranch: lockfile.context.defaultBranch,
    skipSeed: lockfile.context.skipSeed,
    sourceDir: lockfile.context.sourceDir,
    packageManager: lockfile.context.packageManager,
    year: lockfile.context.year,
  };
}

function nonInteractiveAnswers(
  targetDir: string,
  lang: Lang,
  detection: DetectionResult,
  now: Date,
): InitAnswers {
  return {
    projectName: path.basename(targetDir),
    defaultBranch: "main",
    skipSeed: detection.hasCode,
    sourceDir: detection.sourceDir,
    packageManager: lang === "typescript" ? detection.packageManager ?? "bun" : undefined,
    year: now.getFullYear(),
  };
}

async function promptForAnswers(
  targetDir: string,
  lang: Lang,
  detection: DetectionResult,
  deps: AnswerDependencies,
): Promise<InitAnswers | null> {
  const projectName = await deps.prompts.input({
    message: "Project name",
    default: path.basename(targetDir),
    validate: validateProjectName,
  });
  const defaultBranch = await deps.prompts.input({
    message: "Default branch",
    default: (await detectDefaultBranch(targetDir, deps.runCommand, deps.stderr)) ?? "main",
  });
  const skipSeed = detection.hasCode
    ? await deps.prompts.confirm({
        message: "Existing code detected. Skip seed code generation?",
        default: true,
      })
    : false;
  const packageManager =
    lang === "typescript"
      ? detection.packageManager ??
        (await deps.prompts.select({
          message: "Which package manager do you use?",
          choices: packageManagers.map((value) => ({ name: value, value })),
          default: "bun",
        }))
      : undefined;
  const confirmed = await deps.prompts.confirm({
    message: `Scaffold ${lang} project "${projectName}" in ${targetDir}?`,
    default: true,
  });

  if (!confirmed) {
    return null;
  }

  return {
    projectName,
    defaultBranch,
    skipSeed,
    sourceDir: detection.sourceDir,
    packageManager,
    year: deps.now().getFullYear(),
  };
}

export async function resolveAnswers(
  targetDir: string,
  lang: Lang,
  nonInteractive: boolean,
  lockfile: AnvilLockfile | null,
  detection: DetectionResult,
  deps: AnswerDependencies,
): Promise<InitAnswers | null> {
  if (lockfile !== null) {
    return lockedAnswers(lockfile);
  }

  if (nonInteractive) {
    return nonInteractiveAnswers(targetDir, lang, detection, deps.now());
  }

  return promptForAnswers(targetDir, lang, detection, deps);
}

export function contextFromAnswers(
  targetDir: string,
  lang: Lang,
  nonInteractive: boolean,
  answers: InitAnswers,
  detection: DetectionResult,
  toolchain: ToolchainVersions,
  anvilVersion: string,
): ScaffoldContext {
  return {
    projectName: answers.projectName,
    lang,
    targetDir,
    hasExistingCode: detection.hasCode,
    skipSeed: answers.skipSeed,
    sourceDir: answers.sourceDir,
    packageManager: answers.packageManager,
    defaultBranch: answers.defaultBranch,
    nonInteractive,
    toolchain,
    anvilVersion,
    year: answers.year,
  };
}

export async function resolveToolchainVersions(
  lang: Lang,
  lockfile: AnvilLockfile | null,
  deps: ToolchainResolverDependencies = {},
): Promise<ToolchainResolution> {
  if (lockfile !== null) {
    return { toolchain: { ...lockfile.toolchain }, warnings: [] };
  }

  const defaults = loadToolchainDefaults();
  const fetcher = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.fetchTimeoutMs ?? toolchainFetchTimeoutMs;
  const warnings: string[] = [];
  const anvilVersion = deps.anvilVersion ?? defaults.snapshotAnvilVersion;
  const now = deps.now?.() ?? new Date();
  const localBun = await resolveLocalBun(deps.runCommand);
  const bun =
    localBun ??
    (await resolveWithFallback("github.com/oven-sh/bun", "bun", defaults.bun, anvilVersion, warnings, () =>
      fetchLatestBun(fetcher, timeoutMs),
    ));
  const toolchain: ToolchainVersions = { bun };

  if (lang === "typescript") {
    toolchain.node = await resolveWithFallback("nodejs.org", "node", defaults.node, anvilVersion, warnings, () =>
      fetchLatestNode(fetcher, timeoutMs),
    );
  }
  if (lang === "golang") {
    toolchain.go = await resolveWithFallback("go.dev", "go", defaults.go, anvilVersion, warnings, () =>
      fetchLatestGo(fetcher, timeoutMs),
    );
  }
  if (lang === "python") {
    toolchain.python = await resolveWithFallback(
      "endoflife.date",
      "python",
      defaults.python,
      anvilVersion,
      warnings,
      () => fetchLatestPython(fetcher, now, timeoutMs),
    );
  }

  return { toolchain, warnings };
}
