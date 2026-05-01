import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const repoRoot = path.resolve(import.meta.dir, "..");
const requiredToolTestFiles = [
  "tests/e2e/typescript.test.ts",
  "tests/e2e/golang.test.ts",
  "tests/e2e/python.test.ts",
  "tests/parity/anti-slop-parity.test.ts",
  "tests/parity/structural-parity.test.ts",
  "tests/parity/test-quality-parity.test.ts",
  "tests/parity/parity-helpers.ts",
];

describe("required-tool validation does not skip supported-language checks", () => {
  for (const relativePath of requiredToolTestFiles) {
    test(`${relativePath} has no required-tool skip gate`, () => {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(source).not.toMatch(/\btest\.skip\(/);
      expect(source).not.toMatch(/\bdescribe\.skip\(/);
      expect(source).not.toMatch(/\b(?:go|python|lint|check|makeCheck)\w*Test\s*=\s*[^;\n]*\?\s*test\s*:\s*test\.skip/);
      expect(source).not.toContain("skipReason(");
    });
  }
});
