import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type { ConflictAction } from "../types.ts";

type PromptAction = ConflictAction | "diff";

interface SelectConfig {
  message: string;
  choices: Array<{ value: PromptAction }>;
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

let selectResponses: PromptAction[] = [];
let selectCalls: SelectConfig[] = [];
let diffLineCalls: Array<[string, string]> = [];
let diffResult: DiffPart[] = [];
let stderrOutput = "";

const originalStderrWrite = process.stderr.write;

const selectMock = mock(async (config: SelectConfig): Promise<PromptAction> => {
  selectCalls.push(config);

  const response = selectResponses.shift();
  if (response === undefined) {
    throw new Error("Unexpected select call");
  }

  return response;
});

const diffLinesMock = mock((existingContent: string, newContent: string): DiffPart[] => {
  diffLineCalls.push([existingContent, newContent]);
  return diffResult;
});

mock.module("@inquirer/prompts", () => ({
  select: selectMock,
}));

mock.module("diff", () => ({
  diffLines: diffLinesMock,
}));

const conflictModule = await import("./conflict.ts");
const { createInteractiveConflictHandler } = conflictModule;

function setSelectResponses(...responses: PromptAction[]): void {
  selectResponses = [...responses];
}

function stubStderr(): void {
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    stderrOutput += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();

    return true;
  }) as typeof process.stderr.write;
}

describe("createInteractiveConflictHandler", () => {
  beforeEach(() => {
    selectResponses = [];
    selectCalls = [];
    diffLineCalls = [];
    diffResult = [
      { value: "old line\n", removed: true },
      { value: "new line\n", added: true },
    ];
    stderrOutput = "";
    stubStderr();
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
  });

  afterAll(() => {
    mock.restore();
  });

  test("exports only createInteractiveConflictHandler", () => {
    expect(Object.keys(conflictModule).sort()).toEqual(["createInteractiveConflictHandler"]);
  });

  for (const action of ["overwrite", "skip", "abort"] as const satisfies ConflictAction[]) {
    test(`interactive ${action} returns the selected terminal action and preserves the path`, async () => {
      const filePath = `nested/${action}.ts`;
      setSelectResponses(action);

      const result = await createInteractiveConflictHandler()(filePath, "existing\n", "new\n");

      expect(result).toEqual({ path: filePath, action });
      expect(selectCalls).toHaveLength(1);
      expect(selectCalls[0]?.message).toBe(`File already exists: ${filePath}`);
      expect(selectCalls[0]?.choices.map((choice) => choice.value)).toEqual([
        "overwrite",
        "skip",
        "diff",
        "abort",
      ]);
    });
  }

  test("diff then overwrite displays a unified diff, uses jsdiff, and re-prompts", async () => {
    const filePath = "src/example.ts";
    setSelectResponses("diff", "overwrite");

    const result = await createInteractiveConflictHandler()(filePath, "old line\n", "new line\n");

    expect(result).toEqual({ path: filePath, action: "overwrite" });
    expect(selectCalls).toHaveLength(2);
    expect(diffLineCalls).toEqual([["old line\n", "new line\n"]]);
    expect(stderrOutput).toContain(`--- existing ${filePath}`);
    expect(stderrOutput).toContain(`+++ new ${filePath}`);
    expect(stderrOutput).toContain("-old line");
    expect(stderrOutput).toContain("+new line");
  });

  test("diff then skip displays a diff and never returns diff as an action", async () => {
    const filePath = "README.md";
    setSelectResponses("diff", "skip");

    const result = await createInteractiveConflictHandler()(filePath, "old line\n", "new line\n");

    expect(result).toEqual({ path: filePath, action: "skip" });
    expect(selectCalls).toHaveLength(2);
    expect(diffLineCalls).toEqual([["old line\n", "new line\n"]]);
    expect(stderrOutput).toContain(`--- existing ${filePath}`);
    expect(stderrOutput).toContain(`+++ new ${filePath}`);
    expect(stderrOutput).toContain("-old line");
    expect(stderrOutput).toContain("+new line");
  });
});
