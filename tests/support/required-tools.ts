import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";

export interface ToolGate {
  available: boolean;
  missing: string[];
}

export interface RequiredTool {
  name: string;
  command: string;
  probe?: (context: ProbeContext) => ToolGate;
}

export interface RequiredToolOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  nixEntrypoint?: string;
  timeoutMs?: number;
}

interface ProbeContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

const defaultTimeoutMs = 5_000;
const defaultNixEntrypoint = "bun run nix:test";

export function commandRequirement(name: string, command = name): RequiredTool {
  return { name, command };
}

export function python311Requirement(): RequiredTool {
  return {
    name: "python3",
    command: "python3",
    probe: ({ cwd, env, timeoutMs }) => {
      const result = spawnSync(
        "python3",
        ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"],
        { cwd, env, encoding: "utf8", timeout: timeoutMs },
      );

      return result.status === 0 ? { available: true, missing: [] } : { available: false, missing: ["python3>=3.11"] };
    },
  };
}

export function missingRequiredTools(
  requirements: readonly RequiredTool[],
  options: RequiredToolOptions = {},
): ToolGate {
  const context = probeContext(options);
  const missing: string[] = [];

  for (const requirement of requirements) {
    if (!commandAvailable(requirement.command, context.env)) {
      missing.push(requirement.name);
      continue;
    }

    const probe = requirement.probe?.(context);
    if (probe !== undefined && !probe.available) {
      missing.push(...probe.missing);
    }
  }

  return { available: missing.length === 0, missing };
}

export function assertRequiredTools(
  scope: string,
  requirements: readonly RequiredTool[],
  options: RequiredToolOptions = {},
): void {
  const gate = missingRequiredTools(requirements, options);
  if (gate.available) {
    return;
  }

  throw new Error(formatRequiredToolsError(scope, gate.missing, options.nixEntrypoint));
}

export function formatRequiredToolsError(
  scope: string,
  missing: readonly string[],
  nixEntrypoint = defaultNixEntrypoint,
): string {
  return [
    `${scope} environment is missing required tools (D-71/D-72):`,
    ...missing.map((tool) => `- ${tool}`),
    "",
    "Supported-language validation hard-fails instead of skipping when required tools are absent.",
    "Enter the Nix validation environment before retrying:",
    `  ${nixEntrypoint}`,
  ].join("\n");
}

function probeContext(options: RequiredToolOptions): ProbeContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
  };
}

function commandAvailable(command: string, env: NodeJS.ProcessEnv): boolean {
  if (path.isAbsolute(command)) {
    return isExecutableFile(command);
  }

  const pathValue = env.PATH ?? "";
  if (pathValue === "") {
    return false;
  }

  return pathValue.split(path.delimiter).some((dir) => isExecutableFile(path.join(dir, command)));
}

function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
