import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { AnvilLockfile, Lang, ScaffoldContext } from "../types.ts";
import { loadToolchainDefaults } from "../internal/toolchain-defaults.ts";
import { ScaffoldConflictError } from "../scaffold/engine.ts";
import { LOCKFILE_NAME, computeChecksum, writeLockfile } from "../scaffold/lockfile.ts";
import init, { type InitDependencies, type InitResult, type RunCommandResult } from "./init.ts";

class StringWriter {
  text = "";

  write(chunk: string): void {
    this.text += chunk;
  }
}

interface Harness {
  stdout: StringWriter;
  stderr: StringWriter;
  acquired: string[];
  released: string[];
  promptsCalled: string[];
  scaffoldContexts: ScaffoldContext[];
  runCommands: Array<{ command: string; args: string[]; cwd: string }>;
  deps: InitDependencies;
}

let scratch: string;

beforeEach(async () => {
  scratch = path.join(tmpdir(), `anvil-init-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  mock.restore();
  await rm(scratch, { recursive: true, force: true });
});

function makeLockfile(overrides: Partial<AnvilLockfile> = {}): AnvilLockfile {
  const timestamp = "2026-04-26T12:00:00.000Z";
  return {
    version: "0.1.0",
    lang: "typescript",
    flushStatus: "complete",
    context: {
      projectName: "locked-app",
      packageManager: "bun",
      defaultBranch: "main",
      sourceDir: "src",
      skipSeed: false,
      year: 2026,
    },
    toolchain: {
      bun: "1.3.13",
      node: "24.15.0",
    },
    files: [
      {
        path: "README.md",
        checksum: computeChecksum("locked\n"),
        status: "written",
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function okCommand(): RunCommandResult {
  return { exitCode: 0, stdout: "", stderr: "" };
}

function makeHarness(overrides: Partial<InitDependencies> = {}): Harness {
  const stdout = new StringWriter();
  const stderr = new StringWriter();
  const acquired: string[] = [];
  const released: string[] = [];
  const promptsCalled: string[] = [];
  const scaffoldContexts: ScaffoldContext[] = [];
  const runCommands: Array<{ command: string; args: string[]; cwd: string }> = [];

  const deps: InitDependencies = {
    cwd: () => scratch,
    stdin: { isTTY: true },
    stdout,
    stderr,
    prompts: {
      input: async () => {
        promptsCalled.push("input");
        return "prompted-app";
      },
      select: async () => {
        promptsCalled.push("select");
        return "bun";
      },
      confirm: async () => {
        promptsCalled.push("confirm");
        return true;
      },
    },
    acquire: async (targetDir) => {
      acquired.push(targetDir);
      return {
        release: async () => {
          released.push(targetDir);
        },
      };
    },
    detectProject: async () => ({ hasCode: false }),
    resolveToolchain: async () => ({
      toolchain: {
        bun: "1.1.30",
        node: "20.18.0",
      },
      warnings: [],
    }),
    scaffold: async (ctx) => {
      scaffoldContexts.push(ctx);
      await writeFile(path.join(ctx.targetDir, "generated.txt"), "generated\n", "utf8");
      return {
        filesCreated: ["generated.txt"],
        filesSkipped: [],
        lockfile: makeLockfile({
          lang: ctx.lang,
          context: {
            projectName: ctx.projectName,
            packageManager: ctx.packageManager,
            defaultBranch: ctx.defaultBranch,
            sourceDir: ctx.sourceDir,
            skipSeed: ctx.skipSeed,
            year: ctx.year ?? 2026,
          },
          toolchain: ctx.toolchain,
        }),
      };
    },
    previewScaffold: async () => ({
      changes: [],
      filesSkipped: [],
      lockfile: null,
    }),
    runCommand: async (command, args, options) => {
      runCommands.push({ command, args, cwd: options.cwd });
      return okCommand();
    },
    anvilVersion: "0.1.0",
    now: () => new Date("2026-04-26T12:00:00.000Z"),
    ...overrides,
  };

  return {
    stdout,
    stderr,
    acquired,
    released,
    promptsCalled,
    scaffoldContexts,
    runCommands,
    deps,
  };
}

async function runInit(options: { lang: Lang; nonInteractive?: boolean; dryRun?: boolean }, harness: Harness): Promise<InitResult> {
  return init(options, harness.deps);
}

describe("anvil init command", () => {
  test("non-interactive CREATE path uses safe defaults, writes scaffold output, and skips prompts", async () => {
    const harness = makeHarness();

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.promptsCalled).toEqual([]);
    expect(harness.acquired).toEqual([path.resolve(scratch)]);
    expect(harness.released).toEqual(harness.acquired);
    expect(await readFile(path.join(scratch, "generated.txt"), "utf8")).toBe("generated\n");
    expect(harness.scaffoldContexts[0]).toMatchObject({
      projectName: path.basename(scratch),
      lang: "typescript",
      targetDir: path.resolve(scratch),
      hasExistingCode: false,
      skipSeed: false,
      packageManager: "bun",
      defaultBranch: "main",
      nonInteractive: true,
      toolchain: { bun: "1.1.30", node: "20.18.0" },
      anvilVersion: "0.1.0",
      year: 2026,
    });
    expect(harness.runCommands.map((call) => [call.command, ...call.args])).toEqual([
      ["bun", "install"],
      ["git", "--version"],
      ["git", "init"],
      ["pre-commit", "--version"],
      ["pre-commit", "install"],
    ]);
  });

  test("non-dry-run creates a missing target directory before scaffold", async () => {
    const missingTarget = path.join(scratch, "missing-project");
    const harness = makeHarness({
      cwd: () => missingTarget,
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.acquired).toEqual([missingTarget]);
    expect(harness.released).toEqual([missingTarget]);
    expect(await readFile(path.join(missingTarget, "generated.txt"), "utf8")).toBe("generated\n");
  });

  test("pipe without --non-interactive is a clean error with no prompts or writes", async () => {
    const harness = makeHarness({
      stdin: { isTTY: false },
      acquire: async () => {
        throw new Error("acquire should not be called");
      },
      scaffold: async () => {
        throw new Error("scaffold should not be called");
      },
    });

    const result = await runInit({ lang: "typescript" }, harness);

    expect(result.exitCode).toBe(1);
    expect(harness.stderr.text).toContain(
      "error: anvil init requires a TTY for interactive prompts; pass --non-interactive to run headless",
    );
    expect(harness.promptsCalled).toEqual([]);
    expect(await readdir(scratch)).toEqual([]);
  });

  test("non-interactive UPDATE conflicts render diffs and preserve existing files and lockfile", async () => {
    await writeFile(path.join(scratch, "README.md"), "old\n", "utf8");
    await writeLockfile(scratch, makeLockfile());
    const beforeLockfile = await readFile(path.join(scratch, LOCKFILE_NAME), "utf8");
    const harness = makeHarness({
      scaffold: async (_ctx, options) => {
        await options.onReport?.({
          updates: [
            {
              path: "README.md",
              existingContent: "old\n",
              newContent: "new\n",
            },
          ],
        });
        throw new ScaffoldConflictError(1);
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(1);
    expect(harness.stderr.text).toContain("--- existing README.md\n");
    expect(harness.stderr.text).toContain("+++ new README.md\n");
    expect(harness.stderr.text).toContain("1 file differs from current anvil templates.");
    expect(await readFile(path.join(scratch, "README.md"), "utf8")).toBe("old\n");
    expect(await readFile(path.join(scratch, LOCKFILE_NAME), "utf8")).toBe(beforeLockfile);
    expect(harness.released).toEqual(harness.acquired);
  });

  test("cross-language re-scaffold is a hard error before scaffold work", async () => {
    const lockfile = makeLockfile({
      lang: "golang",
      context: {
        projectName: "go-app",
        defaultBranch: "main",
        skipSeed: false,
        year: 2026,
      },
      toolchain: { bun: "1.3.13", go: "1.26.2" },
    });
    await writeLockfile(scratch, lockfile);
    const before = await readFile(path.join(scratch, LOCKFILE_NAME), "utf8");
    const harness = makeHarness({
      scaffold: async () => {
        throw new Error("scaffold should not be called");
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(1);
    expect(harness.stderr.text).toContain("This project was scaffolded for golang.");
    expect(await readFile(path.join(scratch, LOCKFILE_NAME), "utf8")).toBe(before);
    expect(harness.released).toEqual(harness.acquired);
  });

  test("directory lock is released when scaffold throws", async () => {
    const harness = makeHarness({
      scaffold: async () => {
        throw new Error("render failed");
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(1);
    expect(harness.stderr.text).toContain("render failed");
    expect(harness.released).toEqual(harness.acquired);
  });

  test("existing code detection skips seed in non-interactive mode", async () => {
    const harness = makeHarness({
      detectProject: async () => ({ hasCode: true, sourceDir: "src" }),
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.scaffoldContexts[0]?.hasExistingCode).toBe(true);
    expect(harness.scaffoldContexts[0]?.skipSeed).toBe(true);
    expect(harness.stdout.text).not.toContain("safely delete it");
  });

  test("interactive mode collects prompts for fresh TypeScript projects", async () => {
    const promptCalls: string[] = [];
    const harness = makeHarness({
      prompts: {
        input: async (config) => {
          promptCalls.push(`input:${config.message}`);
          return config.message === "Project name" ? "my-app" : "trunk";
        },
        select: async (config) => {
          promptCalls.push(`select:${config.message}`);
          return "pnpm";
        },
        confirm: async (config) => {
          promptCalls.push(`confirm:${config.message}`);
          return true;
        },
      },
    });

    const result = await runInit({ lang: "typescript" }, harness);

    expect(result.exitCode).toBe(0);
    expect(promptCalls).toEqual([
      "input:Project name",
      "input:Default branch",
      "select:Which package manager do you use?",
      'confirm:Scaffold typescript project "my-app" in ' + path.resolve(scratch) + "?",
    ]);
    expect(harness.scaffoldContexts[0]).toMatchObject({
      projectName: "my-app",
      defaultBranch: "trunk",
      packageManager: "pnpm",
      nonInteractive: false,
    });
  });

  test("in-progress lockfile prompts for interactive resume and re-invokes scaffold", async () => {
    await writeLockfile(scratch, {
      ...makeLockfile(),
      flushStatus: "in-progress",
      files: [
        {
          path: "README.md",
          checksum: computeChecksum("locked\n"),
          status: "pending",
        },
      ],
    });
    const harness = makeHarness({
      prompts: {
        input: async () => {
          throw new Error("fresh prompts should not run for locked context");
        },
        select: async () => {
          throw new Error("package prompt should not run for locked context");
        },
        confirm: async (config) => {
          harness.promptsCalled.push(config.message);
          return true;
        },
      },
    });

    const result = await runInit({ lang: "typescript" }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.promptsCalled).toEqual(["Previous init was interrupted. Resume?"]);
    expect(harness.scaffoldContexts).toHaveLength(1);
  });

  test("in-progress lockfile exits cleanly when interactive resume is declined", async () => {
    await writeLockfile(scratch, { ...makeLockfile(), flushStatus: "in-progress" });
    const harness = makeHarness({
      prompts: {
        input: async () => {
          throw new Error("fresh prompts should not run for locked context");
        },
        select: async () => {
          throw new Error("package prompt should not run for locked context");
        },
        confirm: async (config) => {
          harness.promptsCalled.push(config.message);
          return false;
        },
      },
      scaffold: async () => {
        throw new Error("scaffold should not be called when resume is declined");
      },
    });

    const result = await runInit({ lang: "typescript" }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.promptsCalled).toEqual(["Previous init was interrupted. Resume?"]);
    expect(harness.stdout.text).toContain(
      "Aborted. Re-run 'anvil init' to start fresh, or 'anvil doctor' for details.",
    );
    expect(harness.scaffoldContexts).toEqual([]);
    expect(harness.released).toEqual(harness.acquired);
  });

  test("in-progress lockfile exits in non-interactive mode without scaffold work", async () => {
    await writeLockfile(scratch, { ...makeLockfile(), flushStatus: "in-progress" });
    const harness = makeHarness({
      scaffold: async () => {
        throw new Error("scaffold should not be called");
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(1);
    expect(harness.stderr.text).toContain(
      "Previous init was interrupted. Re-run interactively to resume, or run 'anvil doctor' for details.",
    );
    expect(harness.scaffoldContexts).toEqual([]);
    expect(harness.released).toEqual(harness.acquired);
  });

  test("complete lockfile context and toolchain are authoritative on re-scaffold", async () => {
    await writeLockfile(
      scratch,
      makeLockfile({
        context: {
          projectName: "locked-name",
          packageManager: "npm",
          defaultBranch: "trunk",
          sourceDir: "lib",
          skipSeed: true,
          year: 2025,
        },
        toolchain: {
          bun: "9.9.9",
          node: "8.8.8",
        },
      }),
    );
    let resolverCalls = 0;
    const harness = makeHarness({
      detectProject: async () => ({ hasCode: true, sourceDir: "src", packageManager: "bun" }),
      resolveToolchain: async () => {
        resolverCalls += 1;
        return { toolchain: { bun: "1.1.30", node: "20.18.0" }, warnings: [] };
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(resolverCalls).toBe(0);
    expect(harness.scaffoldContexts[0]).toMatchObject({
      projectName: "locked-name",
      packageManager: "npm",
      defaultBranch: "trunk",
      sourceDir: "lib",
      skipSeed: true,
      toolchain: { bun: "9.9.9", node: "8.8.8" },
      year: 2025,
    });
  });

  test("toolchain fallback warnings are surfaced and scaffold continues", async () => {
    const warning =
      "warning: could not reach nodejs.org for latest node version (network unavailable); using bundled default 20.18.0 from anvil 0.1.0. Run online to refresh.";
    const harness = makeHarness({
      resolveToolchain: async () => ({
        toolchain: { bun: "1.1.30", node: "20.18.0" },
        warnings: [warning],
      }),
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.stderr.text).toContain(warning);
    expect(harness.scaffoldContexts[0]?.toolchain).toEqual({ bun: "1.1.30", node: "20.18.0" });
  });

  test("default toolchain resolver falls back to bundled defaults when latest-version fetches fail", async () => {
    const defaults = loadToolchainDefaults();
    const harness = makeHarness({
      resolveToolchain: undefined,
      fetch: async () => {
        throw new Error("network unavailable");
      },
      runCommand: async (command, args, options) => {
        harness.runCommands.push({ command, args, cwd: options.cwd });
        if (command === "bun" && args[0] === "--version") {
          return { exitCode: 0, stdout: `${defaults.bun}\n`, stderr: "" };
        }

        return okCommand();
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.stderr.text).toContain("warning: could not reach nodejs.org for latest node version");
    expect(harness.stderr.text).toContain(`using bundled default ${defaults.node} from anvil 0.1.0`);
    expect(harness.scaffoldContexts[0]?.toolchain).toEqual({ bun: defaults.bun, node: defaults.node });
  });

  test("post-scaffold command failures warn but keep scaffold success", async () => {
    const harness = makeHarness({
      runCommand: async (command, args, options) => {
        harness.runCommands.push({ command, args, cwd: options.cwd });
        if (command === "bun" && args[0] === "install") {
          return { exitCode: 1, stdout: "", stderr: "install failed" };
        }
        return okCommand();
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.stderr.text).toContain("warning: package install failed");
    expect(harness.stdout.text).toContain("Scaffolded typescript project");
  });

  test("git directory stat failures warn and keep scaffold success", async () => {
    const harness = makeHarness({
      stat: async (filePath) => {
        if (String(filePath).endsWith(".git")) {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }

        throw new Error(`unexpected stat path ${String(filePath)}`);
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.stderr.text).toContain("warning: could not inspect .git directory");
    expect(harness.stderr.text).toContain("Git hooks skipped.");
    expect(harness.runCommands.map((call) => [call.command, ...call.args])).toEqual([
      ["bun", "install"],
      ["git", "--version"],
    ]);
  });

  test("summary prints seed disposability message only when seed files were created", async () => {
    const withSeed = makeHarness({
      scaffold: async (ctx) => {
        withSeed.scaffoldContexts.push(ctx);
        return {
          filesCreated: ["src/seed/seed.ts", "README.md"],
          filesSkipped: [],
          lockfile: makeLockfile(),
        };
      },
    });

    expect((await runInit({ lang: "typescript", nonInteractive: true }, withSeed)).exitCode).toBe(0);
    expect(withSeed.stdout.text).toContain("Seed code created at src/seed/");
    expect(withSeed.stdout.text).toContain("safely delete it");

    const withoutSeed = makeHarness({
      scaffold: async (ctx) => {
        withoutSeed.scaffoldContexts.push(ctx);
        return {
          filesCreated: ["README.md"],
          filesSkipped: ["src/seed/seed.ts"],
          lockfile: makeLockfile(),
        };
      },
    });

    expect((await runInit({ lang: "typescript", nonInteractive: true }, withoutSeed)).exitCode).toBe(0);
    expect(withoutSeed.stdout.text).not.toContain("safely delete it");
  });

  test("dry-run previews changes without scaffold flush or post-scaffold commands", async () => {
    const harness = makeHarness({
      scaffold: async () => {
        throw new Error("scaffold should not be called for dry-run");
      },
      previewScaffold: async () => ({
        changes: [
          { path: "README.md", action: "create" },
          { path: "Makefile", action: "update" },
          { path: ".editorconfig", action: "unchanged" },
        ],
        filesSkipped: ["src/seed/seed.ts"],
        lockfile: null,
      }),
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true, dryRun: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.stdout.text).toContain("Dry run: no files written.");
    expect(harness.stdout.text).toContain("Files to create: 1");
    expect(harness.stdout.text).toContain("Files to update: 1");
    expect(harness.runCommands).toEqual([]);
    expect(harness.acquired).toEqual([]);
    expect(harness.released).toEqual([]);
    expect(await readdir(scratch)).toEqual([]);
  });

  test("dry-run does not create a missing target directory", async () => {
    const missingTarget = path.join(scratch, "missing-project");
    const harness = makeHarness({
      cwd: () => missingTarget,
      mkdir: async () => {
        throw new Error("mkdir should not be called for dry-run");
      },
      realpath: async () => {
        throw new Error("realpath should not be called for dry-run");
      },
      previewScaffold: async (ctx) => {
        expect(ctx.targetDir).toBe(missingTarget);
        return {
          changes: [{ path: "README.md", action: "create" }],
          filesSkipped: [],
          lockfile: null,
        };
      },
    });

    const result = await runInit({ lang: "typescript", nonInteractive: true, dryRun: true }, harness);

    expect(result.exitCode).toBe(0);
    expect(harness.acquired).toEqual([]);
    expect(await readdir(scratch)).toEqual([]);
  });

  test("init handler does not reference an offline toolchain flag", async () => {
    const source = await readFile(new URL("./init.ts", import.meta.url), "utf8");

    expect(source).not.toContain("--offline-toolchain");
  });
});
