import { describe, expect, test } from "bun:test";

import { parseScenario, ScenarioSchema, type Scenario } from "./schema.ts";

const inputDirs = [
  "greenfield",
  "with-existing-code",
  "re-scaffold-clean",
  "re-scaffold-drift",
  "re-scaffold-template-bumped",
  "partial-toolchain",
  "monorepo",
  "dirty-git-repo",
  "hostile",
] as const;

function validArgsScenario(input: (typeof inputDirs)[number]) {
  return {
    name: `${input}-scenario`,
    description: `Schema smoke test for ${input}`,
    input,
    args: [],
    expect: {
      exit_code: 0,
      files_exist: ["package.json"],
      files_absent: [".anvil.lock.pid"],
      stdout_empty: false,
      stderr_empty: true,
      files_unchanged_from_input: false,
    },
  };
}

function expectInvalid(scenario: unknown): string {
  const result = ScenarioSchema.safeParse(scenario);
  expect(result.success).toBe(false);

  if (result.success) {
    throw new Error("scenario unexpectedly parsed");
  }

  return result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      const keys = "keys" in issue ? ` keys=${issue.keys.join(",")}` : "";
      return `${path}: ${issue.message}${keys}`;
    })
    .join("\n");
}

describe("ScenarioSchema", () => {
  test("parses one args scenario for every fixture input directory", () => {
    for (const input of inputDirs) {
      const scenario: Scenario = parseScenario(validArgsScenario(input));

      expect(scenario.name).toBe(`${input}-scenario`);
      expect(scenario.input).toBe(input);
      expect(scenario.args).toEqual([]);
      expect(scenario.expect.files_unchanged_from_input).toBe(false);
    }
  });

  test("parses env strings, content assertions, regex assertions, and output assertions", () => {
    const scenario = parseScenario({
      name: "greenfield-ts",
      input: "greenfield",
      args: ["init", "--lang", "typescript", "--non-interactive"],
      env: {
        ANVIL_LOG_LEVEL: "error",
        CI: "1",
      },
      expect: {
        exit_code: 0,
        files_contain: [{ file: "package.json", matches: '"typescript"' }],
        files_match_regex: [{ file: "package.json", pattern: '"name"\\s*:' }],
        stdout_contains: ["created"],
        stderr_contains: [],
        stdout_empty: false,
        stderr_empty: true,
        files_unchanged_from_input: true,
      },
    });

    expect(scenario.env?.ANVIL_LOG_LEVEL).toBe("error");
    expect(scenario.expect.files_match_regex?.[0]?.pattern).toBe('"name"\\s*:');
    expect(scenario.expect.stderr_empty).toBe(true);
  });

  test("parses a pty command and script", () => {
    const scenario = parseScenario({
      name: "greenfield-ts-interactive",
      input: "greenfield",
      pty: {
        command: ["init", "--lang", "typescript"],
        script: [
          { expect: "Project name?", send: "myapp\r" },
          { expect_exit: 0 },
        ],
      },
      expect: {
        files_exist: ["package.json", "src/index.ts"],
      },
    });

    expect(scenario.pty?.command).toEqual(["init", "--lang", "typescript"]);
    expect(scenario.pty?.script).toHaveLength(2);
  });

  test("rejects both args and pty", () => {
    const errors = expectInvalid({
      name: "ambiguous",
      input: "greenfield",
      args: [],
      pty: {
        command: ["init"],
        script: [{ expect_exit: 0 }],
      },
      expect: {},
    });

    expect(errors).toContain("args");
    expect(errors).toContain("pty");
    expect(errors).toContain("exactly one");
  });

  test("rejects neither args nor pty", () => {
    const errors = expectInvalid({
      name: "missing-driver",
      input: "greenfield",
      expect: {},
    });

    expect(errors).toContain("args");
    expect(errors).toContain("pty");
    expect(errors).toContain("exactly one");
  });

  test("rejects scenarios without the required expect object", () => {
    const errors = expectInvalid({
      name: "missing-expect",
      input: "greenfield",
      args: ["init"],
    });

    expect(errors).toContain("expect");
  });

  test("rejects path-like input values", () => {
    for (const input of ["../outside", "greenfield/nested", "/tmp/greenfield", ".", "..", "greenfield\\nested"]) {
      const errors = expectInvalid({
        name: "bad-input",
        input,
        args: ["init"],
        expect: {},
      });

      expect(errors).toContain("input");
      expect(errors).toContain("fixture directory name");
    }
  });

  test("rejects invalid field values with paths naming the offending fields", () => {
    const errors = expectInvalid({
      name: "",
      input: "",
      args: ["init"],
      env: {
        ANVIL_LOG_LEVEL: 1,
      },
      expect: {
        exit_code: "0",
        files_match_regex: [{ file: "package.json", pattern: 123 }],
        stdout_empty: "yes",
      },
    });

    expect(errors).toContain("name");
    expect(errors).toContain("input");
    expect(errors).toContain("env.ANVIL_LOG_LEVEL");
    expect(errors).toContain("expect.exit_code");
    expect(errors).toContain("expect.files_match_regex.0.pattern");
    expect(errors).toContain("expect.stdout_empty");
  });

  test("rejects malformed pty scripts with paths naming the pty fields", () => {
    const errors = expectInvalid({
      name: "bad-pty",
      input: "greenfield",
      pty: {
        command: "init",
        script: [{ expect: "Project name?" }],
      },
      expect: {},
    });

    expect(errors).toContain("pty.command");
    expect(errors).toContain("pty.script");
  });

  test("rejects misspelled assertion keys instead of stripping them", () => {
    const errors = expectInvalid({
      name: "misspelled-assertion",
      input: "greenfield",
      args: ["init"],
      expect: {
        file_exists: ["package.json"],
      },
    });

    expect(errors).toContain("expect");
    expect(errors).toContain("file_exists");
  });
});
