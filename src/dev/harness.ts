import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { createE2eIsolation, type E2eIsolation } from "../internal/e2e-isolation.ts";
import { evaluateAssertions } from "./assertions.ts";
import { runPtyScript, type RunPtyScriptRequest } from "./pty-runner.ts";
import { ScenarioSchema, type Scenario } from "./schema.ts";

export interface RunResult {
  scenario: string;
  passed: boolean;
  failures: string[];
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  workdir: string;
}

interface ProcessResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

interface RunScenarioDeps {
  inputRoot?: string;
  runPtyScript?: (request: RunPtyScriptRequest) => Promise<ProcessResult>;
  tempRoot?: string;
}

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const fixtureInputRoot = path.join(repoRoot, "tests", "fixtures", "inputs");
const anvilEntrypoint = path.join(repoRoot, "bin", "anvil.ts");
const setupBaselineIgnoredTopLevel = new Set([".git", "node_modules"]);

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function bunExecutable(): string {
  return "bun" in process.versions ? process.execPath : "bun";
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv, workdir: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workdir,
      env,
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
        exit_code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function loadScenario(yamlPath: string): Promise<Scenario> {
  const contents = await readFile(yamlPath, "utf8");
  return ScenarioSchema.parse(parseYaml(contents));
}

async function resolveInputDir(input: string, inputRoot = fixtureInputRoot): Promise<string> {
  const resolvedInputRoot = path.resolve(inputRoot);
  const inputDir = path.resolve(resolvedInputRoot, input);
  if (!isInside(resolvedInputRoot, inputDir)) {
    throw new Error(`input fixture ${JSON.stringify(input)} resolves outside ${resolvedInputRoot}`);
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

async function copyInputToWorkdir(inputDir: string, tempRoot = tmpdir()): Promise<string> {
  await mkdir(tempRoot, { recursive: true });
  const workdir = await mkdtemp(path.join(tempRoot, "anvil-fixtures-"));
  try {
    await rm(workdir, { recursive: true, force: true });
    await cp(inputDir, workdir, { recursive: true });
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }

  return workdir;
}

function runAnvil(args: string[], env: NodeJS.ProcessEnv, workdir: string): Promise<ProcessResult> {
  return runProcess(bunExecutable(), [anvilEntrypoint, ...args], env, workdir);
}

function scenarioEnvironment(env: Scenario["env"], isolation: E2eIsolation): NodeJS.ProcessEnv {
  return {
    ...isolation.env,
    ANVIL_REPO_ROOT: repoRoot,
    ANVIL_BIN: anvilEntrypoint,
    ANVIL_BUN: bunExecutable(),
    ...env,
  };
}

async function runSetup(env: NodeJS.ProcessEnv, workdir: string): Promise<ProcessResult | undefined> {
  const setupPath = path.join(workdir, "setup.sh");
  try {
    const setupStat = await stat(setupPath);
    if (!setupStat.isFile()) {
      return {
        exit_code: 1,
        stdout: "",
        stderr: `setup.sh exists but is not a regular file: ${setupPath}`,
      };
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  return runProcess("sh", [setupPath], env, workdir);
}

function formatSetupFailures(result: ProcessResult): string[] {
  const details = [
    `setup.sh failed with exit code ${result.exit_code}`,
  ];
  if (result.stdout.length > 0) {
    details.push(`setup.sh stdout:\n${result.stdout.trimEnd()}`);
  }
  if (result.stderr.length > 0) {
    details.push(`setup.sh stderr:\n${result.stderr.trimEnd()}`);
  }

  return [details.join("\n")];
}

async function copySetupBaseline(workdir: string, tempRoot = tmpdir()): Promise<string> {
  await mkdir(tempRoot, { recursive: true });
  const baselineDir = await mkdtemp(path.join(tempRoot, "anvil-fixtures-baseline-"));
  try {
    await rm(baselineDir, { recursive: true, force: true });
    await cp(workdir, baselineDir, {
      recursive: true,
      preserveTimestamps: true,
      filter: (source) => {
        const relativePath = path.relative(workdir, source);
        const topLevel = relativePath.split(path.sep)[0] ?? "";
        return !setupBaselineIgnoredTopLevel.has(topLevel);
      },
    });
  } catch (error) {
    await rm(baselineDir, { recursive: true, force: true });
    throw error;
  }

  return baselineDir;
}

export async function runScenario(yamlPath: string, deps: RunScenarioDeps = {}): Promise<RunResult> {
  const started = performance.now();
  const scenario = await loadScenario(yamlPath);

  const inputDir = await resolveInputDir(scenario.input, deps.inputRoot);
  const workdir = await copyInputToWorkdir(inputDir, deps.tempRoot);
  const isolation = createE2eIsolation({
    suiteName: "fixtures",
    testName: scenario.name,
    parentDir: path.dirname(workdir),
  });
  const env = scenarioEnvironment(scenario.env, isolation);
  let setupBaselineDir: string | undefined;

  let processResult: ProcessResult;
  let failures: string[];
  try {
    const setupResult = await runSetup(env, workdir);
    if (setupResult !== undefined && setupResult.exit_code !== 0) {
      return {
        scenario: scenario.name,
        passed: false,
        failures: formatSetupFailures(setupResult),
        exit_code: setupResult.exit_code,
        stdout: setupResult.stdout,
        stderr: setupResult.stderr,
        duration_ms: Math.round(performance.now() - started),
        workdir,
      };
    }
    if (scenario.expect.files_unchanged_after_setup !== undefined) {
      setupBaselineDir = await copySetupBaseline(workdir, deps.tempRoot);
    }

    if (scenario.pty !== undefined) {
      processResult = await (deps.runPtyScript ?? runPtyScript)({
        command: bunExecutable(),
        args: [anvilEntrypoint, ...scenario.pty.command],
        cwd: workdir,
        env,
        script: scenario.pty.script,
      });
    } else {
      processResult = await runAnvil(scenario.args ?? [], env, workdir);
    }

    failures = await evaluateAssertions(scenario.expect, {
      workdir,
      inputDir,
      setupBaselineDir,
      exit_code: processResult.exit_code,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
    });
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    if (setupBaselineDir !== undefined) {
      await rm(setupBaselineDir, { recursive: true, force: true });
    }
    throw error;
  } finally {
    isolation.cleanup();
  }

  const result: RunResult = {
    scenario: scenario.name,
    passed: failures.length === 0,
    failures,
    exit_code: processResult.exit_code,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    duration_ms: Math.round(performance.now() - started),
    workdir,
  };

  if (result.passed) {
    await rm(workdir, { recursive: true, force: true });
  }
  if (setupBaselineDir !== undefined) {
    await rm(setupBaselineDir, { recursive: true, force: true });
  }

  return result;
}
