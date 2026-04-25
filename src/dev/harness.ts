import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { evaluateAssertions } from "./assertions.ts";
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

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const fixtureInputRoot = path.join(repoRoot, "tests", "fixtures", "inputs");
const anvilEntrypoint = path.join(repoRoot, "bin", "anvil.ts");

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

async function loadScenario(yamlPath: string): Promise<Scenario> {
  const contents = await readFile(yamlPath, "utf8");
  return ScenarioSchema.parse(parseYaml(contents));
}

async function resolveInputDir(input: string): Promise<string> {
  const inputDir = path.resolve(fixtureInputRoot, input);
  if (!isInside(fixtureInputRoot, inputDir)) {
    throw new Error(`input fixture ${JSON.stringify(input)} resolves outside ${fixtureInputRoot}`);
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

async function copyInputToWorkdir(inputDir: string): Promise<string> {
  const workdir = await mkdtemp(path.join(tmpdir(), "anvil-fixtures-"));
  try {
    await rm(workdir, { recursive: true, force: true });
    await cp(inputDir, workdir, { recursive: true });
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }

  return workdir;
}

function runAnvil(args: string[], env: Scenario["env"], workdir: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bunExecutable(), [anvilEntrypoint, ...args], {
      cwd: workdir,
      env: { ...process.env, ...env },
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

export async function runScenario(yamlPath: string): Promise<RunResult> {
  const started = performance.now();
  const scenario = await loadScenario(yamlPath);

  if (scenario.pty !== undefined) {
    throw new Error(`pty scenarios are unsupported by the TIX-000060 harness core: ${scenario.name}`);
  }

  const inputDir = await resolveInputDir(scenario.input);
  const workdir = await copyInputToWorkdir(inputDir);

  let processResult: ProcessResult;
  let failures: string[];
  try {
    processResult = await runAnvil(scenario.args ?? [], scenario.env, workdir);
    failures = await evaluateAssertions(scenario.expect, {
      workdir,
      inputDir,
      exit_code: processResult.exit_code,
      stdout: processResult.stdout,
      stderr: processResult.stderr,
    });
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
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

  return result;
}
