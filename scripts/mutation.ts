import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Mutant {
  id: string;
  find: string;
  replace: string;
}

export interface MutationCase {
  sourcePath: string;
  testCommand: string[];
  mutants: Mutant[];
}

export interface MutationOutcome {
  sourcePath: string;
  mutantId: string;
  status: "killed" | "survived" | "invalid";
  detail: string;
}

export interface MutationGateResult {
  total: number;
  killed: number;
  survived: number;
  invalid: number;
  outcomes: MutationOutcome[];
  exitCode: number;
}

interface MutationGateOptions {
  cwd?: string;
  timeoutMs?: number;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  runCommand?: (command: string[], cwd: string) => Promise<CommandResult>;
}

interface ResolvedMutationGateOptions {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  runCommand: (command: string[], cwd: string) => Promise<CommandResult>;
}

const defaultMutationTimeoutMs = 60_000;
const forceKillGraceMs = 2_000;
const restoreSignals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;
const signalExitCodes: Record<(typeof restoreSignals)[number], number> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

function bunExecutable(): string {
  return "bun" in process.versions ? process.execPath : "bun";
}

function bunTestCommand(...testPaths: string[]): string[] {
  return [bunExecutable(), "test", ...testPaths];
}

export function defaultMutationCases(): MutationCase[] {
  return [
    {
      sourcePath: "static/typescript/tools/crap-score.ts",
      testCommand: bunTestCommand("tests/crap-score.test.ts"),
      mutants: [
        {
          id: "crap-formula-drops-complexity-square",
          find: "return complexity ** 2 * (1 - coverage) ** 3 + complexity;",
          replace: "return complexity * (1 - coverage) ** 3 + complexity;",
        },
        {
          id: "missing-coverage-succeeds",
          find: [
            "  if (!existsSync(coverageFile)) {",
            "    stderr(`Coverage file not found: ${coverageFile}`);",
            "    return 1;",
            "  }",
          ].join("\n"),
          replace: [
            "  if (!existsSync(coverageFile)) {",
            "    stderr(`Coverage file not found: ${coverageFile}`);",
            "    return 0;",
            "  }",
          ].join("\n"),
        },
        {
          id: "optional-parameter-counted-as-ternary",
          find: 'source[nextMeaningfulIndex] === ":"',
          replace: 'source[nextMeaningfulIndex] === ""',
        },
        {
          id: "nullish-first-question-counted",
          find: 'next === "?" ||',
          replace: "false ||",
        },
      ],
    },
    {
      sourcePath: "src/dev/changed.ts",
      testCommand: bunTestCommand("src/dev/changed.test.ts"),
      mutants: [
        {
          id: "source-changes-skip-fixture-safety-net",
          find: 'isAtOrUnder(filePath, "src")',
          replace: 'isAtOrUnder(filePath, "source")',
        },
        {
          id: "language-template-changes-run-all-fixtures",
          find: 'return aliasToGroup.get(languageSegment.toLowerCase()) ?? "all";',
          replace: 'return "all";',
        },
      ],
    },
  ];
}

function countOccurrences(content: string, find: string): number {
  if (find.length === 0) {
    return 0;
  }

  return content.split(find).length - 1;
}

export function applyMutationToContent(content: string, find: string, replace: string): string {
  const matches = countOccurrences(content, find);
  if (matches !== 1) {
    throw new Error(`expected exactly one match for mutant pattern, found ${matches}`);
  }

  return content.replace(find, replace);
}

function runProcessCommand(
  command: string[],
  cwd: string,
  timeoutMs = defaultMutationTimeoutMs,
): Promise<CommandResult> {
  if (command.length === 0) {
    throw new Error("mutation test command must not be empty");
  }

  return new Promise((resolve, reject) => {
    const [executable, ...args] = command;
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, forceKillGraceMs);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
      if (timedOut) {
        resolve({
          exitCode: 124,
          stdout,
          stderr: [stderr, `mutation test command timed out after ${timeoutMs}ms`]
            .filter((line) => line.length > 0)
            .join("\n"),
        });
        return;
      }

      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function installSignalRestorer(sourcePath: string, original: string): () => void {
  const handlers = restoreSignals.map((signal) => {
    const handler = (): never => {
      writeFileSync(sourcePath, original, "utf8");
      process.exit(signalExitCodes[signal]);
    };
    process.once(signal, handler);
    return { signal, handler };
  });

  return () => {
    for (const { signal, handler } of handlers) {
      process.off(signal, handler);
    }
  };
}

function formatCommand(command: readonly string[]): string {
  return command.join(" ");
}

function commandFailureDetail(result: CommandResult): string {
  return [result.stderr, result.stdout]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(0) ?? `exit ${result.exitCode}`;
}

async function testMutant(
  sourcePath: string,
  original: string,
  mutant: Mutant,
  command: string[],
  options: ResolvedMutationGateOptions,
): Promise<MutationOutcome> {
  let removeSignalRestorer = (): void => undefined;
  try {
    const mutated = applyMutationToContent(original, mutant.find, mutant.replace);
    await writeFile(sourcePath, mutated, "utf8");
    removeSignalRestorer = installSignalRestorer(sourcePath, original);
    const result = await options.runCommand(command, options.cwd);

    if (result.exitCode !== 0) {
      const detail = commandFailureDetail(result);
      options.stdout(`✓ killed ${path.relative(options.cwd, sourcePath)}:${mutant.id} (${detail})`);
      return {
        sourcePath,
        mutantId: mutant.id,
        status: "killed",
        detail,
      };
    }

    const detail = `${formatCommand(command)} exited 0`;
    options.stderr(`✗ survived ${path.relative(options.cwd, sourcePath)}:${mutant.id} (${detail})`);
    return {
      sourcePath,
      mutantId: mutant.id,
      status: "survived",
      detail,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.stderr(`! invalid ${path.relative(options.cwd, sourcePath)}:${mutant.id} (${detail})`);
    return {
      sourcePath,
      mutantId: mutant.id,
      status: "invalid",
      detail,
    };
  } finally {
    removeSignalRestorer();
    await writeFile(sourcePath, original, "utf8");
  }
}

export async function runMutationGate(
  cases: readonly MutationCase[] = defaultMutationCases(),
  options: MutationGateOptions = {},
): Promise<MutationGateResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const stdout = options.stdout ?? (() => undefined);
  const stderr = options.stderr ?? (() => undefined);
  const runCommand = options.runCommand ??
    ((command, commandCwd) => runProcessCommand(command, commandCwd, options.timeoutMs));
  const outcomes: MutationOutcome[] = [];

  for (const mutationCase of cases) {
    const sourcePath = path.isAbsolute(mutationCase.sourcePath)
      ? mutationCase.sourcePath
      : path.join(cwd, mutationCase.sourcePath);
    const original = await readFile(sourcePath, "utf8");

    for (const mutant of mutationCase.mutants) {
      outcomes.push(
        await testMutant(sourcePath, original, mutant, mutationCase.testCommand, {
          cwd,
          stdout,
          stderr,
          runCommand,
        }),
      );
    }
  }

  const killed = outcomes.filter((outcome) => outcome.status === "killed").length;
  const survived = outcomes.filter((outcome) => outcome.status === "survived").length;
  const invalid = outcomes.filter((outcome) => outcome.status === "invalid").length;
  const total = outcomes.length;

  stdout(`Mutation score: ${killed}/${total} killed; ${survived} survived; ${invalid} invalid`);

  return {
    total,
    killed,
    survived,
    invalid,
    outcomes,
    exitCode: total > 0 && survived === 0 && invalid === 0 ? 0 : 1,
  };
}

if (import.meta.main) {
  const result = await runMutationGate(defaultMutationCases(), {
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });
  process.exit(result.exitCode);
}
