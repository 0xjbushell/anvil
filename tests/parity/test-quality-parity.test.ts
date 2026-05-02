import { describe, expect, test } from "bun:test";

import {
  expectFinding,
  goodFixture,
  requireGoAnalyzer,
  requirePythonParityTools,
  parityCommandTestTimeoutMs,
  runEslintRule,
  runFlake8Rule,
  runGoAnalyzer,
  source,
  type ParityRuleFixture,
  type PythonParityFixture,
  type TypeScriptParityFixture,
} from "./parity-helpers.ts";

interface TestQualityCase {
  specId: string;
  rule: string;
  messagePattern: RegExp;
  typescript: TypeScriptParityFixture & { ruleId: string };
  golang: ParityRuleFixture & { analyzerName: string };
  python: PythonParityFixture & { anvCode: string };
}

requireGoAnalyzer();
requirePythonParityTools();

const testQualityCases: TestQualityCase[] = [
  {
    specId: "TEST-01",
    rule: "no-empty-tests",
    messagePattern: /assertion|empty|no assertions?/i,
    typescript: {
      ruleId: "anvil/no-empty-tests",
      filename: "src/service.test.ts",
      code: "it('validates input', () => { const value = compute(); });\n",
      goodCode: "it('validates input', () => { expect(compute()).toBe(true); });\n",
    },
    golang: {
      analyzerName: "noemptytest",
      filename: "service_test.go",
      code: source(`
        package parity
        import "testing"
        func TestService(t *testing.T) { value := 1; _ = value }
      `),
      goodCode: source(`
        package parity
        import "testing"
        func TestService(t *testing.T) { t.Fatal("assertion") }
      `),
    },
    python: {
      anvCode: "ANV201",
      filename: "tests/test_service.py",
      code: "def test_service() -> None:\n    value = 1\n",
      goodCode: "def test_service() -> None:\n    value = 1\n    assert value == 1\n",
    },
  },
  {
    specId: "TEST-02",
    rule: "no-tautological-assertions",
    messagePattern: /tautological|identical|truthy|nil assertion/i,
    typescript: {
      ruleId: "anvil/no-tautological-assertions",
      filename: "src/service.test.ts",
      code: "it('checks truth', () => { expect(true).toBe(true); });\n",
      goodCode: "it('checks result', () => { expect(isReady()).toBe(true); });\n",
    },
    golang: {
      analyzerName: "notautological",
      filename: "service_test.go",
      code: source(`
        package parity
        import "testing"
        type assertions struct{}
        func (assertions) Equal(...any) {}
        var assert assertions
        func TestService(t *testing.T) { assert.Equal(t, 1, 1); if false { t.Fatal("assertion") } }
      `),
      goodCode: source(`
        package parity
        import "testing"
        type assertions struct{}
        func (assertions) Equal(...any) {}
        var assert assertions
        func TestService(t *testing.T) { assert.Equal(t, 1, 2); if false { t.Fatal("assertion") } }
      `),
    },
    python: {
      anvCode: "ANV202",
      filename: "tests/test_service.py",
      code: "def test_service() -> None:\n    assert True\n",
      goodCode: "def test_service() -> None:\n    value = 1\n    assert value == 1\n",
    },
  },
  {
    specId: "TEST-03",
    rule: "no-disabled-tests-without-reason",
    messagePattern: /disabled|skip|reason|explanation/i,
    typescript: {
      ruleId: "anvil/no-disabled-tests-without-reason",
      filename: "src/service.test.ts",
      code: "it.skip('validates input', () => { expect(true).toBe(true); });\n",
      goodCode: "// Skipped: external fixture unavailable\nit.skip('validates input', () => { expect(true).toBe(true); });\n",
    },
    golang: {
      analyzerName: "nodisabledtest",
      filename: "service_test.go",
      code: source(`
        package parity
        import "testing"
        func TestService(t *testing.T) { t.Skip(); t.Fatal("assertion") }
      `),
      goodCode: source(`
        package parity
        import "testing"
        func TestService(t *testing.T) { t.Skip("external fixture unavailable"); t.Fatal("assertion") }
      `),
    },
    python: {
      anvCode: "ANV203",
      filename: "tests/test_service.py",
      code: source(`
        import pytest
        @pytest.mark.skip
        def test_service() -> None:
            value = 1
            assert value == 1
      `),
      goodCode: source(`
        import pytest
        @pytest.mark.skip(reason="external fixture unavailable")
        def test_service() -> None:
            value = 1
            assert value == 1
      `),
    },
  },
  {
    specId: "TEST-04",
    rule: "require-error-path-tests",
    messagePattern: /error-path|error path|raises|source file with error|assertions?/i,
    typescript: {
      ruleId: "anvil/require-error-path-tests",
      filename: "src/service.test.ts",
      extraFiles: {
        "src/service.ts": "export function validate(input) { if (!input) { throw new Error('invalid'); } return input; }\n",
      },
      code: "it('validates happy path', () => { expect(validate('ok')).toBe('ok'); });\n",
      goodCode: "it('validates error path', () => { expect(() => validate('')).toThrow(); });\n",
    },
    golang: {
      analyzerName: "requireerrortest",
      filename: "service_test.go",
      extraFiles: {
        "service.go": source(`
          package parity
          import "errors"
          func work() error { return errors.New("boom") }
          func Validate() error { if err := work(); err != nil { return err }; return nil }
        `),
      },
      code: source(`
        package parity
        import "testing"
        func TestValidate(t *testing.T) { err := Validate(); _ = err; t.Fatal("happy-path assertion") }
      `),
      goodCode: source(`
        package parity
        import "testing"
        func TestValidate(t *testing.T) { if err := Validate(); err == nil { t.Fatal("expected error") } }
      `),
    },
    python: {
      anvCode: "ANV204",
      filename: "tests/test_service.py",
      extraFiles: {
        "src/service.py": source(`
          def validate(value: str) -> str:
              try:
                  if not value:
                      raise ValueError("invalid")
                  return value
              except ValueError:
                  raise
        `),
      },
      code: "def test_validate() -> None:\n    assert validate('ok') == 'ok'\n",
      goodCode: source(`
        import pytest
        def test_validate() -> None:
            with pytest.raises(ValueError):
                validate("")
      `),
    },
  },
];

describe("test-quality parity", () => {
  for (const ruleCase of testQualityCases) {
    describe(`${ruleCase.specId}: ${ruleCase.rule}`, () => {
      test("TypeScript and JavaScript rule fires on bad code and stays clean on good code", async () => {
        const bad = await runEslintRule(ruleCase.typescript.ruleId, ruleCase.typescript);
        expectFinding(bad, ruleCase.messagePattern);

        const good = await runEslintRule(ruleCase.typescript.ruleId, goodFixture(ruleCase.typescript));
        expect(good).toEqual([]);
      });

      test("Go analyzer fires on bad code and stays clean on good code", () => {
        const bad = runGoAnalyzer(ruleCase.golang.analyzerName, ruleCase.golang);
        expectFinding(bad, ruleCase.messagePattern);

        const good = runGoAnalyzer(ruleCase.golang.analyzerName, goodFixture(ruleCase.golang));
        expect(good).toEqual([]);
      }, parityCommandTestTimeoutMs);

      test("Python Flake8 checker fires on bad code and stays clean on good code", () => {
        const bad = runFlake8Rule(ruleCase.python.anvCode, ruleCase.python);
        expectFinding(bad, ruleCase.messagePattern);

        const good = runFlake8Rule(ruleCase.python.anvCode, goodFixture(ruleCase.python));
        expect(good).toEqual([]);
      }, parityCommandTestTimeoutMs);
    });
  }
});
