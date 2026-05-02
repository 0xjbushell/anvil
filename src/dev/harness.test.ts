import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { runScenario } from "./harness.ts";
import { ScenarioSchema, type Scenario } from "./schema.ts";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const fixtureInputRoot = path.join(repoRoot, "tests", "fixtures", "inputs");
const committedScenarioRoot = path.join(repoRoot, "tests", "fixtures", "scenarios");
const sandboxRoot = path.join(repoRoot, ".sandbox", "harness-tests");

let scratch: string;
let previousTmpDir: string | undefined;

type PtyProcessResult = { exit_code: number; stdout: string; stderr: string };
type PtyScriptRunner = (request: {
  command: string;
  args: string[];
  script: NonNullable<Scenario["pty"]>["script"];
  env?: Scenario["env"];
  cwd: string;
}) => Promise<PtyProcessResult>;
type RunScenarioWithPty = (
  yamlPath: string,
  deps: { inputRoot?: string; runPtyScript: PtyScriptRunner },
) => Promise<Awaited<ReturnType<typeof runScenario>>>;

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

async function writeScenarioFile(name: string, scenario: unknown): Promise<string> {
  const scenarioPath = path.join(scratch, `${name}.yaml`);
  await writeFile(scenarioPath, stringifyYaml(scenario), "utf8");
  return scenarioPath;
}

async function inputDirectoryNames(): Promise<string[]> {
  const entries = await readdir(fixtureInputRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function committedScenarioFiles(): Promise<string[]> {
  return (await readdir(committedScenarioRoot))
    .filter((name) => name.endsWith(".yaml"))
    .sort();
}

async function loadCommittedScenarios(): Promise<Array<{ file: string; scenario: Scenario }>> {
  const scenarioFiles = await committedScenarioFiles();
  const scenarios: Array<{ file: string; scenario: Scenario }> = [];

  for (const file of scenarioFiles) {
    const scenario = ScenarioSchema.parse(parseYaml(await readFile(path.join(committedScenarioRoot, file), "utf8")));
    scenarios.push({ file, scenario });
  }

  return scenarios;
}

function isVersionOnlyScenario(scenario: Scenario): boolean {
  return scenario.args?.length === 1 && scenario.args[0] === "--version";
}

function scenarioDriver(scenario: Scenario): string[] {
  return scenario.args ?? scenario.pty?.command ?? [];
}

function isRealScaffoldDriver(scenario: Scenario): boolean {
  return scenarioDriver(scenario)[0] === "init";
}

async function writeInputFile(inputDir: string, relativePath: string, contents: string): Promise<void> {
  const targetPath = path.join(inputDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, "utf8");
}

async function expectRejects(action: () => Promise<unknown>, expectedMessage: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeDefined();
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  expect(message).toMatch(expectedMessage);
}

beforeEach(async () => {
  scratch = path.join(sandboxRoot, randomUUID());
  previousTmpDir = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  if (previousTmpDir === undefined) {
    delete process.env.TMPDIR;
  } else {
    process.env.TMPDIR = previousTmpDir;
  }

  await rm(scratch, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(sandboxRoot, { recursive: true, force: true });
});

describe("runScenario", () => {
  test("passes a scenario, captures output, and deletes the temp workdir", async () => {
    const scenarioPath = await writeScenarioFile("success", {
      name: "success",
      input: "with-existing-code",
      args: ["--version"],
      expect: {
        exit_code: 0,
        files_exist: ["src/foo.ts"],
        files_absent: ["package.json"],
        files_contain: [{ file: "src/foo.ts", matches: "hello, ${name}" }],
        files_match_regex: [{ file: "src/foo.ts", pattern: "export function foo\\(name: string\\): string" }],
        stdout_contains: ["0.1.0"],
        stdout_empty: false,
        stderr_empty: true,
        files_unchanged_from_input: true,
      },
    });

    const result = await runScenario(scenarioPath);

    expect(result.scenario).toBe("success");
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("0.1.0");
    expect(result.stderr).toBe("");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(await pathExists(result.workdir)).toBe(false);
  });

  test("runs setup.sh after copying input and before invoking the scenario command", async () => {
    const inputName = `setup-order-${randomUUID()}`;
    const inputRoot = path.join(scratch, "inputs");
    const inputDir = path.join(inputRoot, inputName);
    const scenarioPath = await writeScenarioFile("setup-order", {
      name: "setup-order",
      input: inputName,
      pty: {
        command: ["--version"],
        script: [{ expect_exit: 0 }],
      },
      expect: {
        exit_code: 0,
        files_exist: ["setup-marker.txt", "setup-script-dir.txt", "protected.txt"],
        files_contain: [{ file: "setup-marker.txt", matches: "setup ran before command" }],
        files_unchanged_after_setup: true,
      },
    });

    try {
      await writeInputFile(
        inputDir,
        "setup.sh",
        [
          "#!/usr/bin/env sh",
          "set -e",
          "printf 'setup ran before command\\n' > setup-marker.txt",
          "printf '%s\\n' \"$(cd \"$(dirname \"$0\")\" && pwd)\" > setup-script-dir.txt",
          "printf 'protected by setup\\n' > protected.txt",
          "chmod 0400 protected.txt",
          "",
        ].join("\n"),
      );
      await chmod(path.join(inputDir, "setup.sh"), 0o755);

      const runScenarioWithPty = runScenario as RunScenarioWithPty;
      const result = await runScenarioWithPty(scenarioPath, {
        inputRoot,
        runPtyScript: async (request) => {
          expect(await readFile(path.join(request.cwd, "setup-marker.txt"), "utf8")).toContain(
            "setup ran before command",
          );
          expect((await readFile(path.join(request.cwd, "setup-script-dir.txt"), "utf8")).trim()).toBe(request.cwd);
          expect((await stat(path.join(request.cwd, "protected.txt"))).mode & 0o777).toBe(0o400);

          return {
            exit_code: 0,
            stdout: "setup-aware pty command\n",
            stderr: "",
          };
        },
      });

      expect(result.passed).toBe(true);
      expect(await pathExists(result.workdir)).toBe(false);
      expect(await pathExists(path.join(inputDir, "setup-marker.txt"))).toBe(false);
      expect(await pathExists(path.join(inputDir, "setup-script-dir.txt"))).toBe(false);
      expect(await pathExists(path.join(inputDir, "protected.txt"))).toBe(false);
    } finally {
      await rm(inputDir, { recursive: true, force: true });
    }
  });

  test("returns a failed scenario with setup output when setup.sh exits non-zero", async () => {
    const inputName = `setup-failure-${randomUUID()}`;
    const inputRoot = path.join(scratch, "inputs");
    const inputDir = path.join(inputRoot, inputName);
    const scenarioPath = await writeScenarioFile("setup-failure", {
      name: "setup-failure",
      input: inputName,
      pty: {
        command: ["--version"],
        script: [{ expect_exit: 0 }],
      },
      expect: {
        exit_code: 0,
      },
    });

    try {
      await writeInputFile(
        inputDir,
        "setup.sh",
        [
          "#!/usr/bin/env sh",
          "set -e",
          "printf 'setup stdout detail\\n'",
          "printf 'setup stderr detail\\n' >&2",
          "printf 'partial setup state\\n' > partial.txt",
          "exit 23",
          "",
        ].join("\n"),
      );
      await chmod(path.join(inputDir, "setup.sh"), 0o755);

      let commandInvoked = false;
      const runScenarioWithPty = runScenario as RunScenarioWithPty;
      const result = await runScenarioWithPty(scenarioPath, {
        inputRoot,
        runPtyScript: async () => {
          commandInvoked = true;
          return {
            exit_code: 0,
            stdout: "anvil command was invoked\n",
            stderr: "",
          };
        },
      });
      const failures = result.failures.join("\n");

      expect(result.passed).toBe(false);
      expect(commandInvoked).toBe(false);
      expect(result.exit_code).toBe(23);
      expect(result.stdout).toContain("setup stdout detail");
      expect(result.stdout).not.toContain("anvil command was invoked");
      expect(result.stderr).toContain("setup stderr detail");
      expect(failures).toContain("setup.sh");
      expect(failures).toContain("23");
      expect(failures).toContain("setup stderr detail");
      expect(await readFile(path.join(result.workdir, "partial.txt"), "utf8")).toContain("partial setup state");
    } finally {
      await rm(inputDir, { recursive: true, force: true });
    }
  });

  test("returns a failing result with a clear exit_code failure and keeps the temp workdir", async () => {
    const scenarioPath = await writeScenarioFile("wrong-exit-code", {
      name: "wrong-exit-code",
      input: "greenfield",
      args: ["--version"],
      expect: {
        exit_code: 123,
      },
    });

    const result = await runScenario(scenarioPath);

    expect(result.passed).toBe(false);
    expect(result.exit_code).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("exit_code");
    expect(result.failures[0]).toContain("123");
    expect(result.failures[0]).toContain("0");
    expect(await pathExists(result.workdir)).toBe(true);
  });

  test("collects multiple assertion failures without short-circuiting", async () => {
    const scenarioPath = await writeScenarioFile("many-failures", {
      name: "many-failures",
      input: "with-existing-code",
      args: ["--version"],
      expect: {
        exit_code: 42,
        files_exist: ["missing.txt"],
        files_absent: ["src/foo.ts"],
        files_contain: [{ file: "src/foo.ts", matches: "not in the file" }],
        files_match_regex: [{ file: "src/foo.ts", pattern: "^not in the file$" }],
        stdout_contains: ["not on stdout"],
        stderr_contains: ["not on stderr"],
        stdout_empty: true,
        stderr_empty: false,
        files_unchanged_from_input: false,
      },
    });

    const result = await runScenario(scenarioPath);
    const failures = result.failures.join("\n");

    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(10);
    for (const key of [
      "exit_code",
      "files_exist",
      "files_absent",
      "files_contain",
      "files_match_regex",
      "stdout_contains",
      "stderr_contains",
      "stdout_empty",
      "stderr_empty",
      "files_unchanged_from_input",
    ]) {
      expect(failures).toContain(key);
    }
    expect(await pathExists(result.workdir)).toBe(true);
  });

  test("passes stderr_contains and stdout_empty assertions for CLI errors", async () => {
    const scenarioPath = await writeScenarioFile("stderr-assertions", {
      name: "stderr-assertions",
      input: "greenfield",
      args: ["not-a-command"],
      expect: {
        exit_code: 1,
        stderr_contains: ["unknown command"],
        stdout_empty: true,
        files_unchanged_from_input: true,
      },
    });

    const result = await runScenario(scenarioPath);

    expect(result.passed).toBe(true);
    expect(result.stderr).toContain("unknown command");
    expect(result.stdout).toBe("");
    expect(await pathExists(result.workdir)).toBe(false);
  });

  test("throws internal errors for missing input fixtures", async () => {
    const scenarioPath = await writeScenarioFile("missing-input", {
      name: "missing-input",
      input: "does-not-exist",
      args: ["--version"],
      expect: {
        exit_code: 0,
      },
    });

    await expectRejects(() => runScenario(scenarioPath), /input fixture.*does-not-exist/i);
  });

  test("validates loaded YAML through the scenario schema", async () => {
    const scenarioPath = path.join(scratch, "invalid-schema.yaml");
    await writeFile(
      scenarioPath,
      [
        "name: invalid-schema",
        "input: greenfield",
        "expect:",
        "  exit_code: 0",
        "",
      ].join("\n"),
      "utf8",
    );

    await expectRejects(() => runScenario(scenarioPath), /exactly one/i);
  });

  test("executes pty scenarios and passes combined PTY output through existing assertions", async () => {
    const scenarioPath = await writeScenarioFile("pty-input", {
      name: "pty-input",
      input: "greenfield",
      pty: {
        command: ["init", "--lang", "typescript"],
        script: [
          { expect: "Project name", send: "pty-input\r" },
          { expect_exit: 0 },
        ],
      },
      expect: {
        exit_code: 0,
        stdout_contains: ["Project name", "Scaffold complete"],
        stderr_empty: true,
      },
    });

    const runScenarioWithPty = runScenario as RunScenarioWithPty;
    const ptyCalls: Array<Parameters<PtyScriptRunner>[0]> = [];
    const result = await runScenarioWithPty(scenarioPath, {
      runPtyScript: async (request) => {
        ptyCalls.push(request);
        const firstStep = request.script[0];
        const firstExpect = firstStep !== undefined && "expect" in firstStep ? firstStep.expect : "";

        return {
          exit_code: 0,
          stdout: `fake pty command: ${[request.command, ...request.args].join(" ")}\n${firstExpect}\nScaffold complete\n`,
          stderr: "",
        };
      },
    });

    expect(ptyCalls).toHaveLength(1);
    expect(ptyCalls[0]).toMatchObject({
      command: expect.stringContaining("bun"),
      args: [expect.stringContaining("bin/anvil.ts"), "init", "--lang", "typescript"],
      script: [
        { expect: "Project name", send: "pty-input\r" },
        { expect_exit: 0 },
      ],
    });
    expect(ptyCalls[0]?.cwd).toContain(`${path.sep}anvil-fixtures-`);
    expect(result.passed).toBe(true);
    expect(result.stdout).toContain("Project name");
    expect(result.stdout).toContain("Scaffold complete");
    expect(result.stderr).toBe("");
    expect(await pathExists(result.workdir)).toBe(false);
  });

  test("runs every committed input scenario through the harness", async () => {
    const inputs = await inputDirectoryNames();
    const committedScenarios = await loadCommittedScenarios();
    const scenarioInputs = new Set(committedScenarios.map(({ scenario }) => scenario.input));

    for (const input of inputs) {
      expect(scenarioInputs.has(input), `expected at least one committed scenario for input ${input}`).toBe(true);
    }

    const versionOnlyWithoutPurpose = committedScenarios
      .filter(({ scenario }) => isVersionOnlyScenario(scenario))
      .map(({ file }) => file);
    expect(versionOnlyWithoutPurpose).toEqual([]);

    const nonScaffoldDrivers = committedScenarios
      .filter(({ scenario }) => !isRealScaffoldDriver(scenario))
      .map(({ file }) => file);
    expect(nonScaffoldDrivers).toEqual([]);

    const languageGreenfields = committedScenarios
      .filter(({ scenario }) => scenario.input === "greenfield" && scenario.args?.[0] === "init")
      .map(({ scenario }) => `${scenario.language}:${scenario.args?.join(" ")}`)
      .sort();
    expect(languageGreenfields).toEqual([
      "golang:init --lang golang --non-interactive",
      "python:init --lang python --non-interactive",
      "typescript:init --lang typescript --non-interactive",
    ]);

    const byName = new Map(committedScenarios.map(({ scenario }) => [scenario.name, scenario]));
    expect(byName.get("re-scaffold-clean")).toMatchObject({
      args: ["init", "--lang", "typescript", "--non-interactive"],
      expect: {
        exit_code: 0,
        stdout_contains: ["Files created: 0", "Files skipped: 0"],
        files_unchanged_after_setup: true,
      },
    });
    expect(byName.get("re-scaffold-drift")).toMatchObject({
      args: ["init", "--lang", "typescript", "--non-interactive"],
      expect: {
        exit_code: 1,
        stderr_contains: [
          "--- existing Makefile",
          "+++ new Makefile",
          "1 file differs from current anvil templates.",
        ],
        files_contain: [{ file: "Makefile", matches: "locally added by user" }],
        files_unchanged_after_setup: true,
      },
    });
    expect(byName.get("re-scaffold-template-bumped")).toMatchObject({
      args: ["init", "--lang", "typescript", "--non-interactive", "--dry-run"],
      expect: {
        exit_code: 0,
        stdout_contains: ["Dry run: no files written.", "Files to update: 1"],
        files_unchanged_after_setup: true,
      },
    });

    for (const { file } of committedScenarios) {
      const result = await runScenario(path.join(committedScenarioRoot, file));
      expect(result.passed, result.failures.join("\n")).toBe(true);
      expect(await pathExists(result.workdir)).toBe(false);
    }
  }, 180_000);
});
