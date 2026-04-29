import { describe, expect, test } from "bun:test";

import {
  expectFinding,
  goAnalyzerGate,
  goodFixture,
  pythonParityGate,
  runEslintRule,
  runFlake8Rule,
  runGoAnalyzer,
  skipReason,
  source,
  type ParityRuleFixture,
  type PythonParityFixture,
  type TypeScriptRuleFixture,
  type TypeScriptParityFixture,
} from "./parity-helpers.ts";

interface AntiSlopCase {
  specId: string;
  rule: string;
  messagePattern: RegExp;
  typescript: TypeScriptParityFixture & { ruleId: string };
  golang: ParityRuleFixture & { analyzerName: string };
  python: PythonParityFixture & { anvCode: string };
}

const goGate = goAnalyzerGate();
const pythonGate = pythonParityGate();
const goParityTest = goGate.available ? test : test.skip;
const pythonParityTest = pythonGate.available ? test : test.skip;

const antiSlopCases: AntiSlopCase[] = [
  {
    specId: "RULE-01",
    rule: "no-log-and-continue",
    messagePattern: /log|continu/i,
    typescript: {
      ruleId: "anvil/no-log-and-continue",
      code: source(`
        function load() { try { foo(); } catch (err) { console.error(err); } }
      `),
      goodCode: source(`
        function load() { try { foo(); } catch (err) { throw err; } }
      `),
    },
    golang: {
      analyzerName: "nologcontinue",
      filename: "parity.go",
      code: source(`
        package parity
        import "errors"
        type logger struct{}
        func (logger) Error(string, ...any) {}
        func work() error { return errors.New("boom") }
        func Load(l logger) { if err := work(); err != nil { l.Error("failed", err) } }
      `),
      goodCode: source(`
        package parity
        import "errors"
        func work() error { return errors.New("boom") }
        func Load() error { if err := work(); err != nil { return err }; return nil }
      `),
    },
    python: {
      anvCode: "ANV001",
      filename: "src/service.py",
      code: source(`
        import logging
        def load() -> None:
            try:
                work()
            except Exception as error:
                logging.error(error)
      `),
      goodCode: source(`
        def load() -> None:
            try:
                work()
            except Exception:
                raise
      `),
    },
  },
  {
    specId: "RULE-02",
    rule: "no-error-obscuring",
    messagePattern: /context|propagat|generic|default|original|wrap/i,
    typescript: {
      ruleId: "anvil/no-error-obscuring",
      code: source(`
        function load() { try { foo(); } catch (err) { return null; } }
      `),
      goodCode: source(`
        function load() { try { foo(); } catch (err) { throw err; } }
      `),
    },
    golang: {
      analyzerName: "noerrorobscuring",
      code: source(`
        package parity
        import "errors"
        func work() error { return errors.New("boom") }
        func Load() error { if err := work(); err != nil { return nil }; return nil }
      `),
      goodCode: source(`
        package parity
        import "errors"
        func work() error { return errors.New("boom") }
        func Load() error { if err := work(); err != nil { return err }; return nil }
      `),
    },
    python: {
      anvCode: "ANV002",
      filename: "src/service.py",
      code: source(`
        def load():
            try:
                work()
            except Exception:
                return None
      `),
      goodCode: source(`
        def load():
            try:
                work()
            except Exception as error:
                raise RuntimeError("load failed") from error
      `),
    },
  },
  {
    specId: "RULE-03",
    rule: "no-placeholder-comments",
    messagePattern: /placeholder|future|comment|todo|temporary|stub/i,
    typescript: {
      ruleId: "anvil/no-placeholder-comments",
      code: source(`
        // TODO implement later
        export const value = 1;
      `),
      goodCode: source(`
        // TODO(ANV-123): migrate after upstream API ships.
        export const value = 1;
      `),
    },
    golang: {
      analyzerName: "noplaceholder",
      code: source(`
        package parity
        // TODO implement later
        func Value() int { return 1 }
      `),
      goodCode: source(`
        package parity
        // TODO(ANV-123): migrate after upstream API ships.
        func Value() int { return 1 }
      `),
    },
    python: {
      anvCode: "ANV003",
      filename: "src/service.py",
      code: source(`
        # TODO implement later
        VALUE = 1
      `),
      goodCode: source(`
        # TODO(ANV-123): migrate after upstream API ships.
        VALUE = 1
      `),
    },
  },
  {
    specId: "RULE-04",
    rule: "no-pass-through-wrapper",
    messagePattern: /pass-through|wrapper|identical/i,
    typescript: {
      ruleId: "anvil/no-pass-through-wrapper",
      code: "function getData(id) { return fetchData(id); }\n",
      goodCode: "function getData(id) { validate(id); return fetchData(id); }\n",
    },
    golang: {
      analyzerName: "nopassthrough",
      code: source(`
        package parity
        func target(id int) int { return id }
        func GetData(id int) int { return target(id) }
      `),
      goodCode: source(`
        package parity
        func target(id int) int { return id }
        func GetData(id int) int { normalized := id + 1; return target(normalized) }
      `),
    },
    python: {
      anvCode: "ANV004",
      filename: "src/service.py",
      code: "def get_data(value):\n    return fetch_data(value)\n",
      goodCode: "def get_data(value):\n    normalized = value.strip()\n    return fetch_data(normalized)\n",
    },
  },
  {
    specId: "RULE-05",
    rule: "no-log-and-throw",
    messagePattern: /log|throw|raise|return|same error/i,
    typescript: {
      ruleId: "anvil/no-log-and-throw",
      code: source(`
        function load() { try { foo(); } catch (err) { console.error(err); throw err; } }
      `),
      goodCode: source(`
        function load() { try { foo(); } catch (err) { throw err; } }
      `),
    },
    golang: {
      analyzerName: "nologthrow",
      code: source(`
        package parity
        import "errors"
        type logger struct{}
        func (logger) Error(string, ...any) {}
        func work() error { return errors.New("boom") }
        func Load(l logger) error { if err := work(); err != nil { l.Error("failed", err); return err }; return nil }
      `),
      goodCode: source(`
        package parity
        import "errors"
        func work() error { return errors.New("boom") }
        func Load() error { if err := work(); err != nil { return err }; return nil }
      `),
    },
    python: {
      anvCode: "ANV005",
      filename: "src/service.py",
      code: source(`
        import logging
        def load() -> None:
            try:
                work()
            except Exception:
                logging.error("failed")
                raise
      `),
      goodCode: source(`
        def load() -> None:
            try:
                work()
            except Exception:
                raise
      `),
    },
  },
  {
    specId: "RULE-06",
    rule: "require-structured-logging",
    messagePattern: /structured|format|print|log/i,
    typescript: {
      ruleId: "anvil/require-structured-logging",
      code: "const logger = pino(); logger.info(`User ${userId} logged in`);\n",
      goodCode: 'const logger = pino(); logger.info({ userId }, "User logged in");\n',
    },
    golang: {
      analyzerName: "structuredlog",
      code: source(`
        package parity
        import "fmt"
        func Load(name string) { fmt.Println(name) }
      `),
      goodCode: source(`
        package parity
        import "log/slog"
        func Load(name string) { slog.Info("user login", "name", name) }
      `),
    },
    python: {
      anvCode: "ANV006",
      filename: "src/service.py",
      code: 'def load() -> None:\n    print("debug")\n',
      goodCode: source(`
        import logging
        def load(name: str) -> None:
            logging.info("user login", extra={"name": name})
      `),
    },
  },
  {
    specId: "RULE-07",
    rule: "require-test-files",
    messagePattern: /test file|corresponding|_test|needs test/i,
    typescript: {
      ruleId: "anvil/require-test-files",
      filename: "src/missing.ts",
      code: "export function missing() { return 1; }\n",
      goodFilename: "src/covered.ts",
      goodCode: "export function covered() { return 1; }\n",
      goodExtraFiles: {
        "src/covered.test.ts": 'import { covered } from "./covered"; test("covered", () => expect(covered()).toBe(1));\n',
      },
    },
    golang: {
      analyzerName: "requiretests",
      filename: "internal/sample/missing.go",
      code: "package sample\nfunc Missing() int { return 1 }\n",
      goodFilename: "internal/sample/covered.go",
      goodCode: "package sample\nfunc Covered() int { return 1 }\n",
      goodExtraFiles: {
        "internal/sample/covered_test.go": source(`
          package sample
          import "testing"
          func TestCovered(t *testing.T) { if Covered() != 1 { t.Fatal("unexpected value") } }
        `),
      },
    },
    python: {
      anvCode: "ANV007",
      filename: "src/missing.py",
      code: "def missing() -> int:\n    return 1\n",
      goodFilename: "src/covered.py",
      goodCode: "def covered() -> int:\n    return 1\n",
      goodExtraFiles: {
        "tests/test_covered.py": "from covered import covered\ndef test_covered() -> None:\n    assert covered() == 1\n",
      },
    },
  },
];

describe("anti-slop parity", () => {
  goParityTest(`Go helper limits diagnostics to the requested analyzer${skipReason(goGate)}`, () => {
    const placeholderOnly: ParityRuleFixture = {
      code: source(`
        package parity
        // TODO implement later
        func Load() {}
      `),
    };

    expectFinding(runGoAnalyzer("noplaceholder", placeholderOnly), /placeholder|todo/i);
    expect(runGoAnalyzer("nologcontinue", placeholderOnly)).toEqual([]);
  });

  for (const ruleCase of antiSlopCases) {
    describe(`${ruleCase.specId}: ${ruleCase.rule}`, () => {
      test("TypeScript and JavaScript rule fires on bad code and stays clean on good code", async () => {
        const bad = await runEslintRule(ruleCase.typescript.ruleId, ruleCase.typescript);
        expectFinding(bad, ruleCase.messagePattern);

        const good = await runEslintRule(ruleCase.typescript.ruleId, goodFixture(ruleCase.typescript));
        expect(good).toEqual([]);
      });

      goParityTest(`Go analyzer fires on bad code and stays clean on good code${skipReason(goGate)}`, () => {
        const bad = runGoAnalyzer(ruleCase.golang.analyzerName, ruleCase.golang);
        expectFinding(bad, ruleCase.messagePattern);

        const good = runGoAnalyzer(ruleCase.golang.analyzerName, goodFixture(ruleCase.golang));
        expect(good).toEqual([]);
      });

      pythonParityTest(`Python Flake8 checker fires on bad code and stays clean on good code${skipReason(pythonGate)}`, () => {
        const bad = runFlake8Rule(ruleCase.python.anvCode, ruleCase.python);
        expectFinding(bad, ruleCase.messagePattern);

        const good = runFlake8Rule(ruleCase.python.anvCode, goodFixture(ruleCase.python));
        expect(good).toEqual([]);
      });
    });
  }
});
