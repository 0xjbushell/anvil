import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { applyMutationToContent, runMutationGate, type CommandResult } from "../scripts/mutation.ts";

const scratchRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => rm(root, { recursive: true, force: true })));
  scratchRoots.clear();
});

async function makeScratch(): Promise<string> {
  const scratch = path.join(tmpdir(), `anvil-mutation-test-${crypto.randomUUID()}`);
  scratchRoots.add(scratch);
  await mkdir(scratch, { recursive: true });
  return scratch;
}

describe("mutation gate", () => {
  test("applies only exact single-match mutants", () => {
    expect(applyMutationToContent("return value + 1;\n", "value + 1", "value - 1")).toBe("return value - 1;\n");
    expect(() => applyMutationToContent("return value;\n", "missing", "replacement")).toThrow(
      /expected exactly one match/i,
    );
    expect(() => applyMutationToContent("x();\nx();\n", "x();", "y();")).toThrow(/expected exactly one match/i);
  });

  test("kills mutants through the configured test command and restores source files", async () => {
    const scratch = await makeScratch();
    const sourcePath = path.join(scratch, "sample.ts");
    await writeFile(sourcePath, "export const enabled = true;\n", "utf8");
    const commands: string[][] = [];

    const result = await runMutationGate(
      [
        {
          sourcePath,
          testCommand: ["bun", "test", "sample.test.ts"],
          mutants: [
            {
              id: "flip-enabled",
              find: "enabled = true",
              replace: "enabled = false",
            },
          ],
        },
      ],
      {
        cwd: scratch,
        runCommand: async (command): Promise<CommandResult> => {
          commands.push(command);
          const source = await readFile(sourcePath, "utf8");
          return source.includes("enabled = false")
            ? { exitCode: 1, stdout: "", stderr: "expected true" }
            : { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(1);
    expect(result.survived).toBe(0);
    expect(commands).toEqual([["bun", "test", "sample.test.ts"]]);
    expect(await readFile(sourcePath, "utf8")).toBe("export const enabled = true;\n");
  });

  test("reports surviving mutants and still restores source files", async () => {
    const scratch = await makeScratch();
    const sourcePath = path.join(scratch, "sample.ts");
    await writeFile(sourcePath, "export const limit = 10;\n", "utf8");

    const result = await runMutationGate(
      [
        {
          sourcePath,
          testCommand: ["bun", "test", "sample.test.ts"],
          mutants: [
            {
              id: "raise-limit",
              find: "limit = 10",
              replace: "limit = 11",
            },
          ],
        },
      ],
      {
        cwd: scratch,
        runCommand: async (): Promise<CommandResult> => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.killed).toBe(0);
    expect(result.survived).toBe(1);
    expect(await readFile(sourcePath, "utf8")).toBe("export const limit = 10;\n");
  });

  test("times out hanging mutant commands and restores source files", async () => {
    const scratch = await makeScratch();
    const sourcePath = path.join(scratch, "sample.ts");
    await writeFile(sourcePath, "export const enabled = true;\n", "utf8");

    const result = await runMutationGate(
      [
        {
          sourcePath,
          testCommand: [process.execPath, "--eval", "setTimeout(() => {}, 10_000);"],
          mutants: [
            {
              id: "hangs-after-mutation",
              find: "enabled = true",
              replace: "enabled = false",
            },
          ],
        },
      ],
      {
        cwd: scratch,
        timeoutMs: 10,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(1);
    expect(result.outcomes[0]?.detail).toContain("timed out");
    expect(await readFile(sourcePath, "utf8")).toBe("export const enabled = true;\n");
  });
});
