import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  calculateCrapScore,
  computeFunctionReports,
  countCyclomaticComplexity,
  runCrapScore,
} from "../static/typescript/tools/crap-score.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "anvil-crap-score-"));

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function writeCoverageProject(source: string, coverageOverrides = {}) {
  const projectDir = mkdtempSync(join(tempRoot, "project-"));
  const coverageDir = join(projectDir, "coverage");
  const sourcePath = join(projectDir, "src", "sample.ts");
  const coveragePath = join(coverageDir, "coverage-final.json");

  mkdirSync(join(projectDir, "src"), { recursive: true });
  mkdirSync(coverageDir, { recursive: true });
  writeFileSync(sourcePath, source);
  writeFileSync(
    coveragePath,
    JSON.stringify(
      {
        [sourcePath]: {
          path: sourcePath,
          fnMap: {
            0: {
              name: "sample",
              decl: { start: { line: 1, column: 16 }, end: { line: 1, column: 22 } },
              loc: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
            },
          },
          f: { 0: 1 },
          statementMap: {
            0: { start: { line: 2, column: 2 }, end: { line: 2, column: 18 } },
            1: { start: { line: 4, column: 2 }, end: { line: 4, column: 15 } },
          },
          s: { 0: 1, 1: 0 },
          branchMap: {
            0: {
              loc: { start: { line: 2, column: 2 }, end: { line: 4, column: 3 } },
              locations: [
                { start: { line: 2, column: 13 }, end: { line: 2, column: 18 } },
                { start: { line: 4, column: 2 }, end: { line: 4, column: 15 } },
              ],
            },
          },
          b: { 0: [1, 0] },
          ...coverageOverrides,
        },
      },
      null,
      2,
    ),
  );

  return { projectDir, coverageDir, sourcePath };
}

describe("CRAP score script", () => {
  test("calculates the CRAP formula", () => {
    expect(calculateCrapScore(1, 1)).toBe(1);
    expect(calculateCrapScore(10, 0)).toBe(110);
    expect(calculateCrapScore(5, 0.5)).toBe(8.125);
    expect(calculateCrapScore(20, 0.3)).toBeCloseTo(157.2);
  });

  test("counts lexical cyclomatic complexity", () => {
    const source = [
      "function sample(value) {",
      "  if (value && value.enabled) {",
      "    return value.enabled ? value.items?.length ?? 0 : 0;",
      "  }",
      "  do { value = next(value); } while (value.pending);",
      "  switch (value.kind) { case 'x': return 1; default: return 0; }",
      "}",
    ].join("\n");

    expect(countCyclomaticComplexity(source)).toBe(8);
  });

  test("does not count else, optional chaining, or nullish coalescing as complexity", () => {
    const source = [
      "function simple(value) {",
      "  if (value) {",
      "    return value.child?.name ?? 'unknown';",
      "  } else {",
      "    return 'missing';",
      "  }",
      "}",
    ].join("\n");

    expect(countCyclomaticComplexity(source)).toBe(2);
  });

  test("does not count TypeScript optional parameter syntax as a ternary", () => {
    const source = 'function sample(value?: string): string { return value || "x"; }';

    expect(countCyclomaticComplexity(source)).toBe(2);
  });

  test("counts multiline ternaries", () => {
    const source = [
      "function sample(value) {",
      "  return value",
      "    ? value.name",
      "    : 'missing';",
      "}",
    ].join("\n");

    expect(countCyclomaticComplexity(source)).toBe(2);
  });

  test("does not count nullish coalescing inside ternary branches", () => {
    const source = "function sample(value) { return value ? value.name ?? 'missing' : 'empty'; }";

    expect(countCyclomaticComplexity(source)).toBe(2);
  });

  test("computes function reports from Istanbul coverage", () => {
    const { sourcePath } = writeCoverageProject(
      [
        "export function sample(value) {",
        "  if (value) {",
        "    return value;",
        "  }",
        "  return null;",
        "}",
      ].join("\n"),
    );

    const report = computeFunctionReports({
      [sourcePath]: {
        path: sourcePath,
        fnMap: {
          0: {
            name: "sample",
            decl: { start: { line: 1, column: 16 }, end: { line: 1, column: 22 } },
            loc: { start: { line: 1, column: 0 }, end: { line: 6, column: 1 } },
          },
        },
        f: { 0: 1 },
        statementMap: {
          0: { start: { line: 2, column: 2 }, end: { line: 2, column: 14 } },
          1: { start: { line: 5, column: 2 }, end: { line: 5, column: 14 } },
        },
        s: { 0: 1, 1: 0 },
        branchMap: {},
        b: {},
      },
    });

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      file: sourcePath,
      functionName: "sample",
      complexity: 2,
      coverage: 0.5,
    });
  });

  test("returns a failing exit code when coverage is missing", async () => {
    const projectDir = mkdtempSync(join(tempRoot, "missing-"));
    const errors: string[] = [];

    await mkdir(join(projectDir, "coverage"), { recursive: true });
    const exitCode = runCrapScore([], {
      cwd: projectDir,
      stdout: () => undefined,
      stderr: (line) => errors.push(line),
    });

    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("coverage-final.json");
  });

  test("returns a failing exit code when a function exceeds the error threshold", () => {
    const source = [
      "export function sample(value) {",
      "  if (value) {",
      "    return value;",
      "  }",
      "  return null;",
      "}",
    ].join("\n");
    const { projectDir } = writeCoverageProject(source, {
      s: { 0: 0, 1: 0 },
      b: { 0: [0, 0] },
    });
    const lines: string[] = [];

    const exitCode = runCrapScore(["--threshold-error", "2"], {
      cwd: projectDir,
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(line),
    });

    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("ERROR");
  });
});
