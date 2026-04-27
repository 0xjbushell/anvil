import { describe, expect, test } from "bun:test";

import type { ScaffoldContext } from "../types.ts";
import { runPostScaffold, type CommandRunner } from "./init-post.ts";

class StringWriter {
  text = "";

  write(chunk: string): void {
    this.text += chunk;
  }
}

function makeContext(overrides: Partial<ScaffoldContext> = {}): ScaffoldContext {
  return {
    projectName: "example",
    lang: "typescript",
    targetDir: "/tmp/example",
    hasExistingCode: false,
    skipSeed: false,
    packageManager: "bun",
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "1.3.13", node: "24.15.0" },
    anvilVersion: "0.1.0",
    year: 2026,
    ...overrides,
  };
}

function callText(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

describe("post-scaffold commands", () => {
  test("skips git init and hooks when git is unavailable", async () => {
    const stderr = new StringWriter();
    const calls: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push(callText(command, args));
      if (command === "bun" && args[0] === "install") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "--version") {
        return { exitCode: 1, stdout: "", stderr: "missing" };
      }

      throw new Error(`unexpected command ${callText(command, args)}`);
    };

    await runPostScaffold(makeContext(), { stderr, runCommand });

    expect(calls).toEqual(["bun install", "git --version"]);
    expect(stderr.text).toContain("warning: git not installed - git init and hooks skipped.");
  });

  test("does not run git init when the target already has a git directory", async () => {
    const stderr = new StringWriter();
    const calls: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push(callText(command, args));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runPostScaffold(makeContext(), {
      stderr,
      runCommand,
      stat: async (filePath) => {
        expect(String(filePath)).toBe("/tmp/example/.git");
        return {};
      },
    });

    expect(calls).toEqual(["bun install", "git --version", "pre-commit --version", "pre-commit install"]);
    expect(stderr.text).toBe("");
  });

  test("stops before pre-commit when git init fails", async () => {
    const stderr = new StringWriter();
    const calls: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push(callText(command, args));
      if (command === "git" && args[0] === "init") {
        return { exitCode: 1, stdout: "", stderr: "init failed" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runPostScaffold(makeContext(), {
      stderr,
      runCommand,
      stat: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    expect(calls).toEqual(["bun install", "git --version", "git init"]);
    expect(stderr.text).toContain("warning: git init failed (git init exited 1). Run manually: git init");
  });

  test("warns and skips hooks when git directory probing fails", async () => {
    const stderr = new StringWriter();
    const calls: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push(callText(command, args));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runPostScaffold(makeContext(), {
      stderr,
      runCommand,
      stat: async () => {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      },
    });

    expect(calls).toEqual(["bun install", "git --version"]);
    expect(stderr.text).toContain(
      "warning: could not inspect .git directory (permission denied). Git hooks skipped.",
    );
  });

  test("warns and skips hook install when pre-commit is unavailable", async () => {
    const stderr = new StringWriter();
    const calls: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push(callText(command, args));
      if (command === "pre-commit" && args[0] === "--version") {
        return { exitCode: 1, stdout: "", stderr: "missing" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await runPostScaffold(makeContext(), {
      stderr,
      runCommand,
      stat: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
    });

    expect(calls).toEqual(["bun install", "git --version", "git init", "pre-commit --version"]);
    expect(stderr.text).toContain(
      "warning: pre-commit not installed - hooks skipped. Install: pip install pre-commit",
    );
  });

  test("runs language-specific install commands", async () => {
    const stderr = new StringWriter();
    const calls: string[] = [];
    const runCommand: CommandRunner = async (command, args) => {
      calls.push(callText(command, args));
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const gitPresent = async () => ({});

    await runPostScaffold(makeContext({ lang: "golang", packageManager: undefined, toolchain: { bun: "1.3.13", go: "1.26.2" } }), {
      stderr,
      runCommand,
      stat: gitPresent,
    });
    await runPostScaffold(
      makeContext({
        lang: "python",
        packageManager: undefined,
        toolchain: { bun: "1.3.13", python: "3.14.4" },
      }),
      { stderr, runCommand, stat: gitPresent },
    );

    expect(calls).toEqual([
      "go mod tidy",
      "git --version",
      "pre-commit --version",
      "pre-commit install",
      "uv pip install -e .[dev]",
      "git --version",
      "pre-commit --version",
      "pre-commit install",
      "uv pip install -e tools/flake8-plugin/",
    ]);
  });
});
