import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { stringify as stringifyYaml } from "yaml";

import { runScenario } from "./harness.ts";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const fixtureInputRoot = path.join(repoRoot, "tests", "fixtures", "inputs");
const committedScenarioRoot = path.join(repoRoot, "tests", "fixtures", "scenarios");
const sandboxRoot = path.join(repoRoot, ".sandbox", "harness-tests");

let scratch: string;
let previousTmpDir: string | undefined;

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

  test("throws a clear unsupported error for pty scenarios", async () => {
    const scenarioPath = await writeScenarioFile("pty-input", {
      name: "pty-input",
      input: "greenfield",
      pty: {
        command: ["init", "--lang", "typescript"],
        script: [{ expect_exit: 0 }],
      },
      expect: {
        exit_code: 0,
      },
    });

    await expectRejects(() => runScenario(scenarioPath), /pty.*unsupported/i);
  });

  test("runs every committed input scenario through the harness", async () => {
    const inputs = await inputDirectoryNames();
    const scenarioFiles = (await readdir(committedScenarioRoot))
      .filter((name) => name.endsWith(".yaml"))
      .sort();

    expect(scenarioFiles).toEqual(inputs.map((input) => `${input}.yaml`));

    for (const scenarioFile of scenarioFiles) {
      const result = await runScenario(path.join(committedScenarioRoot, scenarioFile));
      expect(result.passed, result.failures.join("\n")).toBe(true);
      expect(await pathExists(result.workdir)).toBe(false);
    }
  }, 30_000);
});
