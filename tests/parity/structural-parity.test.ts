import { describe, expect, test } from "bun:test";

import {
  expectFinding,
  goodFixture,
  requireGoAnalyzer,
  requirePythonParityTools,
  runEslintRule,
  runFlake8Rule,
  runGoAnalyzer,
  source,
  type ParityRuleFixture,
  type PythonParityFixture,
  type TypeScriptParityFixture,
} from "./parity-helpers.ts";

interface StructuralCase {
  specId: string;
  rule: string;
  messagePattern: RegExp;
  typescript?: TypeScriptParityFixture & { ruleId: string };
  golang?: ParityRuleFixture & { analyzerName: string };
  python?: PythonParityFixture & { anvCode: string };
}

requireGoAnalyzer();
requirePythonParityTools();

const structuralCases: StructuralCase[] = [
  {
    specId: "STRUCT-03",
    rule: "types-file-organization",
    messagePattern: /types?\.|type/i,
    typescript: {
      ruleId: "anvil/types-file-organization",
      filename: "src/service.ts",
      code: "export type UserId = string;\n",
      goodFilename: "src/types.ts",
      goodCode: "export type UserId = string;\n",
    },
    python: {
      anvCode: "ANV103",
      filename: "src/service.py",
      code: source(`
        from typing import TypedDict
        class UserRecord(TypedDict):
            id: str
      `),
      goodFilename: "src/types.py",
      goodCode: source(`
        from typing import TypedDict
        class UserRecord(TypedDict):
            id: str
      `),
    },
  },
  {
    specId: "STRUCT-04",
    rule: "errors-file-organization",
    messagePattern: /errors?\.|error/i,
    typescript: {
      ruleId: "anvil/errors-file-organization",
      filename: "src/service.ts",
      code: "export class ValidationError extends Error {}\n",
      goodFilename: "src/errors.ts",
      goodCode: "export class ValidationError extends Error {}\n",
    },
    python: {
      anvCode: "ANV104",
      filename: "src/service.py",
      code: "class ValidationError(Exception):\n    pass\n",
      goodFilename: "src/errors.py",
      goodCode: "class ValidationError(Exception):\n    pass\n",
    },
  },
  {
    specId: "STRUCT-05",
    rule: "constants-file-organization",
    messagePattern: /constants?\.|constant/i,
    typescript: {
      ruleId: "anvil/constants-file-organization",
      filename: "src/service.ts",
      code: 'export const API_URL = "https://api.example.com";\n',
      goodFilename: "src/constants.ts",
      goodCode: 'export const API_URL = "https://api.example.com";\n',
    },
    python: {
      anvCode: "ANV105",
      filename: "src/service.py",
      code: 'API_URL = "https://api.example.com"\n',
      goodFilename: "src/constants.py",
      goodCode: 'API_URL = "https://api.example.com"\n',
    },
  },
  {
    specId: "STRUCT-06",
    rule: "enums-file-organization",
    messagePattern: /enums?\.|enum/i,
    typescript: {
      ruleId: "anvil/enums-file-organization",
      filename: "src/service.ts",
      code: "export enum Status { Active, Inactive }\n",
      goodFilename: "src/enums.ts",
      goodCode: "export enum Status { Active, Inactive }\n",
    },
    python: {
      anvCode: "ANV106",
      filename: "src/service.py",
      code: source(`
        from enum import Enum
        class Status(Enum):
            ACTIVE = "active"
      `),
      goodFilename: "src/enums.py",
      goodCode: source(`
        from enum import Enum
        class Status(Enum):
            ACTIVE = "active"
      `),
    },
  },
  {
    specId: "STRUCT-07",
    rule: "filename-match-export",
    messagePattern: /filename|export|symbol|match/i,
    typescript: {
      ruleId: "anvil/filename-match-export",
      filename: "src/right-name.ts",
      code: "export function wrongName() { return null; }\n",
      goodCode: "export function rightName() { return null; }\n",
    },
    python: {
      anvCode: "ANV107",
      filename: "src/right_name.py",
      code: "def wrong_name():\n    return None\n",
      goodCode: "def right_name():\n    return None\n",
    },
  },
  {
    specId: "STRUCT-08",
    rule: "no-exported-function-expressions",
    messagePattern: /function expression|lambda|declaration|export/i,
    typescript: {
      ruleId: "anvil/no-exported-function-expressions",
      filename: "src/service.ts",
      code: "export const getData = () => [];\n",
      goodCode: "export function getData() { return []; }\n",
    },
    golang: {
      analyzerName: "noexportedfunctionexpressions",
      code: "package parity\nvar Build = func() {}\n",
      goodCode: "package parity\nfunc Build() {}\n",
    },
    python: {
      anvCode: "ANV108",
      filename: "src/service.py",
      code: "make_value = lambda: 1\n",
      goodCode: "def make_value():\n    return 1\n",
    },
  },
];

describe("structural parity", () => {
  test("omits Go for STRUCT-03 through STRUCT-07 because D-47 and D-30 make those scaffold-only or inapplicable", () => {
    const goExcluded = structuralCases
      .filter((ruleCase) => ruleCase.specId !== "STRUCT-08")
      .every((ruleCase) => ruleCase.golang === undefined);

    expect(goExcluded).toBe(true);
    expect(structuralCases.find((ruleCase) => ruleCase.specId === "STRUCT-08")?.golang).toBeDefined();
  });

  for (const ruleCase of structuralCases) {
    describe(`${ruleCase.specId}: ${ruleCase.rule}`, () => {
      if (ruleCase.typescript !== undefined) {
        test("TypeScript and JavaScript rule fires on bad code and stays clean on good code", async () => {
          const bad = await runEslintRule(ruleCase.typescript.ruleId, ruleCase.typescript);
          expectFinding(bad, ruleCase.messagePattern);

          const good = await runEslintRule(ruleCase.typescript.ruleId, goodFixture(ruleCase.typescript));
          expect(good).toEqual([]);
        });
      }

      if (ruleCase.golang !== undefined) {
        test("Go analyzer fires on bad code and stays clean on good code", () => {
          const bad = runGoAnalyzer(ruleCase.golang.analyzerName, ruleCase.golang);
          expectFinding(bad, ruleCase.messagePattern);

          const good = runGoAnalyzer(ruleCase.golang.analyzerName, goodFixture(ruleCase.golang));
          expect(good).toEqual([]);
        });
      }

      if (ruleCase.python !== undefined) {
        test("Python Flake8 checker fires on bad code and stays clean on good code", () => {
          const bad = runFlake8Rule(ruleCase.python.anvCode, ruleCase.python);
          expectFinding(bad, ruleCase.messagePattern);

          const good = runFlake8Rule(ruleCase.python.anvCode, goodFixture(ruleCase.python));
          expect(good).toEqual([]);
        });
      }
    });
  }
});
