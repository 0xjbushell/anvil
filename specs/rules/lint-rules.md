# Custom Lint Rules

## Traceability

- **Shared Key**: `lint-rules`
- **Spec Path**: `specs/rules/lint-rules.md`
- **Requirement Refs**: `RULE-01` through `RULE-08`, `STRUCT-01` through `STRUCT-08`, `TEST-01` through `TEST-05`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-05, D-06, D-07, D-15, D-16, D-17, D-19, D-25, D-26, D-27, D-30, D-34, D-36)

## Problem Statement

Coding agents produce code that passes basic linting but exhibits "slop" — structurally complete code that makes no real decisions. Existing lint rule sets (ESLint recommended, golangci-lint defaults, Ruff defaults) don't catch these patterns because they focus on syntax correctness, not engineering judgment. Anvil needs custom lint rules that detect laziness patterns, enforce structural organization, and verify test quality — implemented natively in each language's lint ecosystem.

## Scope

### In Scope

- 8 anti-slop rules (RULE-01 through RULE-08)
- 8 structural rules (STRUCT-01 through STRUCT-08)
- 5 test quality rules (TEST-01 through TEST-05)
- Implementation in 3 lint ecosystems: ESLint (TS/JS), go vet -vettool (Go), Flake8 (Python)
- Cross-file analysis where needed (require-test-files, require-error-path-tests)

### Out of Scope

- Config-only rules (handled by aggressive lint config — see toolchain spec)
- Framework-specific rules (React, Django, Gin)
- Runtime analysis

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| TS/JS lint platform | ESLint v9+ flat config with local plugin (relative import) | `[research]` D-15 |
| Go lint platform | `go vet -vettool` with `multichecker.Main()` (single binary, one pass) | `[research]` D-16 |
| Python lint platform | Flake8 plugin via `uv pip install -e` | `[research]` D-17, D-28 |
| Structural rules | Default-on, not opt-in | `[user]` D-19 |
| Structured logging | Pattern-based (flag unstructured calls, accept any structured logger) | `[user]` D-05 |
| File size thresholds | Language-tuned defaults, user-configurable | `[user]` D-06 |
| File organization scope | Exported declarations only (Factory approach) | `[user]` D-07 |
| Error code prefix (Flake8) | `ANV` (1-3 uppercase letters, validated by learning test) | `[research]` |
| ESLint API | `context.filename` (not `getFilename()`, removed in v10) | `[research]` |

## Architecture

### Component Overview

Rules are organized by category and implemented per language:

```
static/
├── typescript/lint-rules/
│   ├── plugin.js              # ESLint plugin entry (exports rules object)
│   ├── anti-slop/
│   │   ├── no-log-and-continue.js
│   │   ├── no-error-obscuring.js
│   │   ├── no-placeholder-comments.js
│   │   ├── no-pass-through-wrapper.js
│   │   ├── no-log-and-throw.js
│   │   ├── require-structured-logging.js
│   │   ├── require-test-files.js
│   │   └── no-async-noise.js
│   ├── structural/
│   │   ├── types-file-organization.js
│   │   ├── errors-file-organization.js
│   │   ├── constants-file-organization.js
│   │   ├── enums-file-organization.js
│   │   ├── filename-match-export.js
│   │   └── no-exported-function-expressions.js
│   └── test-quality/
│       ├── no-empty-tests.js
│       ├── no-tautological-assertions.js
│       ├── no-disabled-tests-without-reason.js
│       ├── require-error-path-tests.js
│       └── no-snapshot-only-tests.js
├── golang/analyzers/
│   ├── cmd/
│   │   └── anvil-lint/main.go   # multichecker.Main() combining all 16 analyzers
│   ├── anti_slop/               # Analyzer packages
│   │   ├── nologcontinue.go
│   │   ├── noerrorobscuring.go
│   │   ├── noplaceholder.go
│   │   ├── nopassthrough.go
│   │   ├── nologthrow.go
│   │   ├── structuredlog.go
│   │   └── requiretests.go
│   ├── structural/
│   │   ├── typefileorg.go
│   │   ├── errorfileorg.go
│   │   ├── constfileorg.go
│   │   ├── enumfileorg.go
│   │   └── nofuncexpressions.go
│   ├── test_quality/
│   │   ├── noemptytest.go
│   │   ├── notautological.go
│   │   ├── nodisabledtest.go
│   │   └── requireerrortest.go
│   ├── go.mod
│   └── Makefile               # Builds single anvil-lint binary
└── python/flake8-plugin/
    ├── anvil_lint/
    │   ├── __init__.py        # Plugin entry point
    │   ├── anti_slop.py       # Anti-slop checkers
    │   ├── structural.py      # Structural checkers
    │   └── test_quality.py    # Test quality checkers
    ├── setup.py               # For uv pip install -e
    └── setup.cfg              # Flake8 entry points
```

### Rule Catalog

#### Category A: Anti-Slop Rules

| ID | Rule | What it detects | Languages |
|----|------|-----------------|-----------|
| RULE-01 | `no-log-and-continue` | catch/except that only logs (no re-raise, no return, no recovery) | TS, Go, Py |
| RULE-02 | `no-error-obscuring` | catch that returns a default value or throws a generic error, discarding context | TS, Go, Py |
| RULE-03 | `no-placeholder-comments` | Comments matching: TODO without ticket, "implement later", "add error handling", "placeholder", "fill in", "temporary" | TS, Go, Py |
| RULE-04 | `no-pass-through-wrapper` | Function whose body is a single call to another function with the same arguments | TS, Go, Py |
| RULE-05 | `no-log-and-throw` | Log + throw/return-error in same block (duplicate error reporting) | TS, Go, Py |
| RULE-06 | `require-structured-logging` | Flags: `console.log()`, `fmt.Println()`, `print()`, `logger.info("string " + var)`. Accepts: any call with object/key-value arguments. **Go:** allowlists known structured loggers (`log/slog`, `zap`, `zerolog`, `logrus`); flags `fmt.Print*`, `log.Print*`, and string formatting in logger calls. | TS, Go, Py |
| RULE-07 | `require-test-files` | Source file in source directory has no corresponding `*_test.go` / `*.test.ts` / `test_*.py`. Exempts: declaration-only files (types, errors, constants, enums); entry points (Go `cmd/**/main.go`, TS `index.ts` at root, Python `__main__.py`). Source directories configurable via lint config (D-34); defaults: TS→`src/`, Go→`internal/`+`pkg/`, Python→`src/`. | TS, Go, Py |
| RULE-08 | `no-async-noise` | Redundant `return await`, async functions that never `await` | TS only |

#### Category B: Structural Rules

| ID | Rule | What it detects | Languages | Default thresholds |
|----|------|-----------------|-----------|-------------------|
| STRUCT-01 | `max-file-length` | File exceeds line count threshold | TS, Go, Py | TS: 250w/400e, Go: 350w/500e, Py: 200w/350e |
| STRUCT-02 | `max-function-length` | Function exceeds line count threshold | TS, Go, Py | 50 warn / 80 error (all) |

**STRUCT-01 and STRUCT-02 implementation (D-36):** These rules use existing tooling where available — ESLint `max-lines`/`max-lines-per-function` for TS/JS, `funlen` in golangci-lint for Go. Only Python implements them as custom Flake8 checkers. They are NOT counted in custom analyzer/checker totals for TS/JS and Go.
| STRUCT-03 | `types-file-organization` | Exported type/interface outside `types.{ext}` | TS, Go, Py | — |
| STRUCT-04 | `errors-file-organization` | Exported error class/type outside `errors.{ext}` | TS, Go, Py | — |
| STRUCT-05 | `constants-file-organization` | Exported constant outside `constants.{ext}` | TS, Go, Py | — |
| STRUCT-06 | `enums-file-organization` | Exported enum outside `enums.{ext}` | TS, Go, Py | — |
| STRUCT-07 | `filename-match-export` | File's primary export name doesn't match filename | TS, Py | — |
| STRUCT-08 | `no-exported-function-expressions` | TS: `export const fn = () => {}` instead of `export function fn() {}`. Go: `var Fn = func() {}` instead of `func Fn() {}`. Python: module-level `fn = lambda: ...` instead of `def fn(): ...` | TS, Go, Py |

**File organization rules (STRUCT-03 through STRUCT-06):** Follow Factory's approach — only **exported** declarations are flagged. Non-exported (private) types, constants, errors, and enums can live wherever. Additionally, `types.ts` files can only contain type declarations (bidirectional enforcement).

**Python exports:** If `__all__` is defined in the module, use it. Otherwise, any name NOT prefixed with `_` is considered exported. (D-25)

**Go enums:** The complete enum pattern (`type X int` + `const (... = iota)`) lives in `enums.go`. The types-file-org and constants-file-org analyzers exempt iota-based enum declarations — identified by a `const` block using `iota` with a typed constant. (D-26)

**STRUCT-07 Go exemption:** `filename-match-export` does not apply to Go. Go files routinely contain multiple exported symbols at package scope, making "primary export" undefined. (D-30)

#### Category C: Test Quality Rules

| ID | Rule | What it detects | Languages |
|----|------|-----------------|-----------|
| TEST-01 | `no-empty-tests` | Test function with no assertions (empty body or only setup) | TS, Go, Py |
| TEST-02 | `no-tautological-assertions` | `expect(true).toBe(true)`, `assert.Equal(t, 1, 1)`, `assert True` | TS, Go, Py |
| TEST-03 | `no-disabled-tests-without-reason` | `.skip` / `t.Skip()` / `@pytest.mark.skip` without explanation string | TS, Go, Py |
| TEST-04 | `require-error-path-tests` | Source file has error handling (try/catch, if err, try/except) but corresponding test file has zero error-path assertions. **Concrete patterns per language:** TS: `expect(...).toThrow()`, `expect(...).rejects`, `catch` in test. Go: `require.Error()`, `assert.Error()`, `if err != nil` in test. Python: `pytest.raises(...)`, `self.assertRaises(...)`. | TS, Go, Py |
| TEST-05 | `no-snapshot-only-tests` | Test file uses only `toMatchSnapshot()` / `toMatchInlineSnapshot()` with no behavioral assertions | TS only |

### Language-Specific Implementation Notes

#### TypeScript/JS (ESLint)

- Plugin is a CommonJS module (`module.exports = { rules: { ... } }`)
- Imported in `eslint.config.mjs` via relative path: `import anvilPlugin from './tools/lint-rules/plugin.js'`
- Cross-file rules (RULE-07, TEST-04) use `fs.existsSync` and `fs.readFileSync` within the rule's `Program` visitor
- AST node types: `CatchClause`, `TryStatement`, `CallExpression`, `ExportNamedDeclaration`, `TSTypeAliasDeclaration`, `TSInterfaceDeclaration`, etc.

#### Go (go vet -vettool)

- All analyzers combined into a single binary using `golang.org/x/tools/go/analysis/multichecker` (not singlechecker)
- One binary, one pass over the codebase (16 analyzers in parallel, not 16 separate `go vet` invocations)
- Built via `go build -o bin/anvil-lint ./cmd/anvil-lint` in the project's `tools/go-analyzers/` directory
- `cmd/anvil-lint/main.go` calls `multichecker.Main(analyzer1, analyzer2, ...)` with all 16 analyzers
- Invoked via `go vet -vettool=./tools/go-analyzers/bin/anvil-lint ./...`
- Makefile target builds the binary on first lint run
- AST analysis via `go/ast`, `go/types` packages
- Cross-file: Go analyzers naturally analyze packages (multiple files)

#### Python (Flake8)

- Plugin registered via `setup.cfg` entry points under `flake8.extension`
- Error codes use `ANV` prefix: `ANV001` (no-log-and-continue), `ANV002` (no-error-obscuring), etc.
- Installed via `uv pip install -e tools/flake8-plugin/`
- AST analysis via Python's built-in `ast` module
- Cross-file: checker receives `filename` parameter; can read sibling files with `os.path` + `open()`
- **Export detection:** If `__all__` exists in module, use it. Otherwise, names without `_` prefix = exported. (D-25)

#### Python test file mapping (RULE-07)

For source file `src/{module}/{name}.py`, the rule checks for corresponding test files in this order:
1. `tests/test_{name}.py` (flat test directory)
2. `tests/{module}/test_{name}.py` (mirrored directory)

If either exists, the rule is satisfied. This matches the seed code layout (`src/seed/seed.py` → `tests/test_seed.py`).

### Key Interfaces

#### ESLint Rule Module

```javascript
module.exports = {
  meta: {
    type: 'problem' | 'suggestion',
    docs: { description, recommended: true },
    messages: { messageId: 'Error message template' },
    schema: [],  // no options for most rules (Factory approach)
    // Cross-file rules (RULE-07, TEST-04) accept sourceDir option:
    // schema: [{ type: 'object', properties: { sourceDir: { type: 'string' } } }]
  },
  create(context) {
    return {
      CatchClause(node) { /* analysis */ },
      Program(node) { /* cross-file checks */ },
    };
  },
};
```

#### Go Analyzer

```go
// Each analyzer is defined as a package-level var (e.g., in nologcontinue/analyzer.go)
var Analyzer = &analysis.Analyzer{
    Name: "nologcontinue",
    Doc:  "reports catch blocks that only log without handling the error",
    Run:  run,
}

// cmd/anvil-lint/main.go combines all analyzers into one binary
func main() {
    multichecker.Main(
        nologcontinue.Analyzer,
        noerrorobscuring.Analyzer,
        // ... all 16 analyzers
    )
}
```

#### Flake8 Checker

```python
class AnvilAntiSlopChecker:
    name = 'anvil-anti-slop'
    version = '0.1.0'

    def __init__(self, tree: ast.AST, filename: str):
        self.tree = tree
        self.filename = filename

    def run(self) -> Generator[tuple[int, int, str, type], None, None]:
        for node in ast.walk(self.tree):
            # analysis
            yield (line, col, 'ANV001 ...', type(self))
```

## What Changes

### New Artifacts

| Category | Language | Files |
|----------|----------|-------|
| Anti-Slop | TS/JS | 8 ESLint rule files + plugin entry |
| Anti-Slop | Go | 7 analyzer cmd directories |
| Anti-Slop | Python | `anti_slop.py` with 7 checkers |
| Structural | TS/JS | 6 ESLint rule files |
| Structural | Go | 5 analyzer packages |
| Structural | Python | `structural.py` with 6 checkers |
| Test Quality | TS/JS | 5 ESLint rule files |
| Test Quality | Go | 4 analyzer cmd directories |
| Test Quality | Python | `test_quality.py` with 4 checkers |

Total: ~19 ESLint rules, ~16 Go analyzers, ~17 Flake8 checkers = **~52 implementations** of **21 unique rules** (STRUCT-07 not implemented for Go; STRUCT-01/02 are config-driven for TS/JS and Go per D-36, custom Flake8 checkers for Python only).

### Workflow Changes

- Every source file is checked against anti-slop and structural rules in the inner loop (pre-commit, make lint)
- Every test file is checked against test quality rules
- Cross-file rules (RULE-07, TEST-04) run during full lint, not on individual file saves

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| False positives on file organization (edge cases) | Medium | Medium | Exported-only scope reduces false positives. User can disable per-rule in config. |
| Cross-file rules slow on large repos | Medium | Low | Only run on full lint (make lint), not file-save hooks. Cache results where possible. |
| Placeholder comment regex too aggressive | Medium | Medium | Use slop-scan's battle-tested patterns (lines 9-17 of placeholder-comments.ts). Require pattern match + absence of actionable context. |
| Go analyzer build fails on first lint | Low | High | Clear error message with manual build instructions. Doctor checks build status. |
| Flake8 plugin install fails (virtualenv issues) | Medium | Medium | Doctor checks plugin installation. Clear error message. |

## Testing Strategy

### Per-Rule Unit Tests

Each rule gets a test file with:
- **Valid cases** — code that should NOT trigger the rule (minimum 3)
- **Invalid cases** — code that SHOULD trigger the rule with exact error position (minimum 3)
- **Edge cases** — boundary conditions specific to each rule

For ESLint: use `RuleTester` from `eslint`.
For Go: use `analysistest.Run` from `golang.org/x/tools/go/analysis/analysistest`.
For Flake8: use `flake8.api.legacy` or direct checker instantiation.

### Cross-Language Parity Tests

For each rule implemented in multiple languages, verify that equivalent code in each language produces the same lint result. This ensures consistent behavior across languages.

### Integration Tests

- Scaffold a project with `anvil init` → run `make lint` → verify zero violations on seed code
- Modify seed code to introduce each category of violation → verify lint catches it
- Verify cross-file rules work (delete a test file → `require-test-files` fires)
