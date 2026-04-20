# Custom Lint Rules

## Traceability

- **Shared Key**: `lint-rules`
- **Spec Path**: `specs/rules/lint-rules.md`
- **Requirement Refs**: `RULE-01` through `RULE-09`, `STRUCT-01` through `STRUCT-08`, `TEST-01` through `TEST-05`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-05, D-06, D-07, D-15, D-16, D-17, D-19, D-25, D-26, D-27, D-30, D-34, D-36, D-47, D-48, D-49, D-50, D-51, D-52, D-53, D-54)

## Problem Statement

Coding agents produce code that passes basic linting but exhibits "slop" — structurally complete code that makes no real decisions. Existing lint rule sets (ESLint recommended, golangci-lint defaults, Ruff defaults) don't catch these patterns because they focus on syntax correctness, not engineering judgment. Anvil needs custom lint rules that detect laziness patterns, enforce structural organization, and verify test quality — implemented natively in each language's lint ecosystem.

## Scope

### In Scope

- 9 anti-slop rules (RULE-01 through RULE-09)
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
│   │   ├── no-async-noise.js
│   │   └── no-silent-error-swallow.js
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
│   │   └── anvil-lint/main.go   # multichecker.Main() combining all 14 analyzers
│   ├── anti_slop/               # Analyzer packages
│   │   ├── nologcontinue.go
│   │   ├── noerrorobscuring.go
│   │   ├── noplaceholder.go
│   │   ├── nopassthrough.go
│   │   ├── nologthrow.go
│   │   ├── structuredlog.go
│   │   ├── requiretests.go
│   │   └── nosilentswallow.go
│   ├── structural/
│   │   ├── filelength.go
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

**Re-export policy:** Re-exports (`export { Foo } from './foo'`) do not count as exported declarations for STRUCT-03 through STRUCT-07. Only the **definition site** determines where a declaration must live. A file that only re-exports types from `types.ts` is not violating file organization rules. (D-49)

#### Category A: Anti-Slop Rules

| ID | Rule | What it detects | Languages |
|----|------|-----------------|-----------|
| RULE-01 | `no-log-and-continue` | catch/except that only logs (no re-raise, no return, no recovery) | TS, Go, Py |
| RULE-02 | `no-error-obscuring` | catch that discards error context: (a) returns a default/fallback value without logging or wrapping the original error, or (b) throws a new generic error (e.g., `throw new Error('Something went wrong')`) without wrapping or chaining the original error. The key signal is that the original error's message, stack, or type is lost. This rule requires that error context is preserved through at least one of: wrapping (`new Error('msg', { cause: err })`), chaining (`fmt.Errorf("%w", err)`), or re-throwing the original error. | TS, Go, Py |
| RULE-03 | `no-placeholder-comments` | Comments matching slop patterns (see below). **Exception:** TODO comments with a ticket reference (e.g., `// TODO(PROJ-123): ...`) are NOT flagged. Only vague future-work comments without actionable context are flagged. **Patterns flagged:** `TODO` without parenthesized reference, `FIXME` without reference, `HACK`. Phrases: "implement later", "add error handling here", "placeholder", "fill in", "temporary", "stub". **Patterns NOT flagged:** `TODO(PROJ-123)` (has ticket reference). | TS, Go, Py |
| RULE-04 | `no-pass-through-wrapper` | Function whose body is a single call to another function with the same arguments | TS, Go, Py |
| RULE-05 | `no-log-and-throw` | Log + throw/return-error in same block (duplicate error reporting). Log + throw/return-error must be in the **same catch block or error-handling branch**. Logging in one function and throwing in a caller does not trigger this rule. | TS, Go, Py |
| RULE-06 | `require-structured-logging` | Flags unstructured log calls: `fmt.Println()`, `print()`, `logger.info("string " + var)`. Accepts: any call with object/key-value arguments. **Go:** allowlists known structured loggers (`log/slog`, `zap`, `zerolog`, `logrus`); flags `fmt.Print*`, `log.Print*`, and string formatting in logger calls. **TS/JS:** Does NOT flag `console.*` — that is handled by CONFIG-01's `no-console` rule (D-51). RULE-06 allowlists known structured loggers (`pino`, `winston`, `bunyan`, `log4js`, `roarr`); flags string concatenation/template literals in their method calls (e.g., `logger.info('User ' + name)` instead of `logger.info({ name }, 'User logged in')`). Unrecognized `logger.*` calls are NOT flagged — the rule only enforces correct usage of known loggers. The allowlist is configurable via ESLint rule options (`structuredLoggers: ["pino", "winston", ...]`) to support project-specific loggers. **Python:** flags `print()` and string formatting in `logging.*` calls (e.g., `logging.info(f"User {name}")` instead of `logging.info("User %s", name)`). | TS, Go, Py |
| RULE-07 | `require-test-files` | Source file in source directory has no corresponding `*_test.go` / `*.test.ts` / `test_*.py`. Exempts: declaration-only files (types, errors, constants, enums); entry points (Go `cmd/**/main.go`, TS/JS `index.ts`/`index.js`/`index.mjs` at any directory level (barrel files that re-export from the directory), Python `__main__.py`). Index files at any level are exempt because they are organizational barrel files — their purpose is re-exporting, not containing business logic. They should not require their own test file. (D-52) Source directories configurable via lint config (D-34); defaults: TS→`src/`, Go→`internal/`+`pkg/`, Python→`src/`. | TS, Go, Py |
| RULE-08 | `no-async-noise` | Redundant `return await`, async functions that never `await` | TS only |
| RULE-09 | `no-silent-error-swallow` | Empty catch/except/recover blocks with no handling at all (no logging, no re-throw, no comment explaining why). Different from RULE-01 which catches "log-only" handling. **Go clarification (D-53):** `break` and `continue` inside `if err != nil` blocks are also considered silent error swallowing — they suppress the error without propagation. Only `return err`, `return fmt.Errorf(...)`, `log.Fatal(err)`, or explicit error-handling logic is acceptable. (D-50) | TS, Go, Py |

**RULE-09 implementation notes:**
- **TS:** `CatchClause` with empty `body.body` array (or body containing only empty statements)
- **Go:** `if err != nil { }` blocks with empty body, or `defer func() { recover() }()` with no handling
- **Python:** `except: pass` or `except Exception: ...` with only `pass`
- Must allow intentional suppression with explicit comment: `// intentionally ignored` or `# nosec` etc.

#### Category B: Structural Rules

| ID | Rule | What it detects | Languages | Default thresholds |
|----|------|-----------------|-----------|-------------------|
| STRUCT-01 | `max-file-length` | File exceeds line count threshold | TS, Go, Py | TS: 400, Go: 500, Py: 350 (error) |
| STRUCT-02 | `max-function-length` | Function exceeds line count threshold | TS, Go, Py | 80 lines (error, all) |

**STRUCT-01 and STRUCT-02 implementation (D-36, updated):** These rules use existing tooling where available:
- **TS/JS:** ESLint `max-lines` (STRUCT-01) and `max-lines-per-function` (STRUCT-02) — config-driven, NOT custom rules. Single threshold (error-only) per ESLint rule semantics.
- **Go:** `funlen` in golangci-lint handles STRUCT-02 (function length: `lines: 80`) only. STRUCT-01 (file length) uses a custom analyzer in the `anvil-lint` binary (golangci-lint has no file-length linter). STRUCT-01 IS counted in Go custom analyzer totals.
- **Python:** Custom Flake8 checkers for both (Python's Flake8 has no built-in equivalent with configurable thresholds).

STRUCT-01 and STRUCT-02 are NOT counted in custom analyzer/checker totals for TS/JS. For Go, only STRUCT-01 is counted (STRUCT-02 is config-driven via `funlen`).

**Threshold configuration:** STRUCT-01 thresholds are configured per-language in the respective tool configs (ESLint `max-lines` options, Go custom analyzer flags via `.golangci.yml` settings, Python Flake8 plugin `--max-file-length` option in `setup.cfg`). STRUCT-02 thresholds use the same mechanism (ESLint `max-lines-per-function`, Go `funlen.lines` in `.golangci.yml`, Python Flake8 `--max-function-length` in `setup.cfg`). All structural thresholds are single-level (error). Teams wanting a warning threshold can lower the error threshold.

| STRUCT-03 | `types-file-organization` | Exported type/interface outside `types.{ext}` | TS, Py (Go: scaffold-only) | — |
| STRUCT-04 | `errors-file-organization` | Exported error class/type outside `errors.{ext}` | TS, Py (Go: scaffold-only) | — |
| STRUCT-05 | `constants-file-organization` | Exported constant outside `constants.{ext}` | TS, Py (Go: scaffold-only) | — |
| STRUCT-06 | `enums-file-organization` | Exported enum outside `enums.{ext}` | TS, Py (Go: scaffold-only) | — |
| STRUCT-07 | `filename-match-export` | File exports exactly one symbol, and that symbol's name doesn't match the filename (case-insensitive, kebab-case to camelCase allowed). Files with multiple exports are exempt — 'primary export' is only defined for single-export files. (D-48) | TS, Py | — |
| STRUCT-08 | `no-exported-function-expressions` | TS: `export const fn = () => {}` instead of `export function fn() {}`. Go: `var Fn = func() {}` instead of `func Fn() {}`. Python: module-level `fn = lambda: ...` instead of `def fn(): ...` | TS, Go, Py |

**File organization rules (STRUCT-03 through STRUCT-06):** Follow Factory's approach — only **exported** declarations are flagged. Non-exported (private) types, constants, errors, and enums can live wherever. Additionally, `types.ts` files can only contain type declarations (bidirectional enforcement).

**Go file organization (STRUCT-03 through STRUCT-06) (D-47):** These rules are **scaffold-only** for Go — they are reflected in the seed code structure and AGENTS.md guidance, but are NOT enforced by custom Go analyzers. Go's idiomatic style places related types, constants, and errors close to their usage within a package. Enforcing strict file organization via lint would fight Go conventions. The seed code demonstrates the pattern; AGENTS.md recommends it; agents can follow it or not.

**Python exports:** If `__all__` is defined in the module, use it. Otherwise, any name NOT prefixed with `_` is considered exported. (D-25)

**Go enums:** The complete enum pattern (`type X int` + `const (... = iota)`) lives in `enums.go`. The types-file-org and constants-file-org analyzers exempt iota-based enum declarations — identified by a `const` block using `iota` with a typed constant. (D-26)

**STRUCT-07 Go exemption:** `filename-match-export` does not apply to Go. Go files routinely contain multiple exported symbols at package scope, making "primary export" undefined. (D-30)

#### Category C: Test Quality Rules

| ID | Rule | What it detects | Languages |
|----|------|-----------------|-----------|
| TEST-01 | `no-empty-tests` | Test function with no assertions (empty body or only setup). **Concrete assertion patterns per language:** TS: any call matching `expect(...)` (Vitest/Jest), `assert(...)`, or `assert.X(...)` from `node:assert`. Go: any call on `*testing.T` matching `t.Error*`/`t.Fatal*`/`t.Fail*`, or any `testify` `assert.*`/`require.*` call. Python: any `assert` statement, any `pytest.raises`/`pytest.warns` context, or any `unittest` `self.assert*` call. A test is "empty" if zero matching AST nodes are found in its body (comments and setup-only code don't count). | TS, Go, Py |
| TEST-02 | `no-tautological-assertions` | `expect(true).toBe(true)`, `assert.Equal(t, 1, 1)`, `assert True` | TS, Go, Py |
| TEST-03 | `no-disabled-tests-without-reason` | `.skip` / `t.Skip()` / `@pytest.mark.skip` without explanation string | TS, Go, Py |
| TEST-04 | `require-error-path-tests` | Source file has error handling (try/catch, if err, try/except) but corresponding test file has zero error-path assertions. This rule uses AST analysis (not regex) to detect error-handling patterns in source and assertion patterns in tests. It looks for AST nodes representing try/catch/except blocks in source, and assertion call expressions matching error-testing patterns in tests. **Concrete patterns per language:** TS: `expect(...).toThrow()`, `expect(...).rejects`, `catch` in test. Go: `require.Error()`, `assert.Error()`, `if err != nil` in test. Python: `pytest.raises(...)`, `self.assertRaises(...)`. | TS, Go, Py |
| TEST-05 | `no-snapshot-only-tests` | Test file uses only `toMatchSnapshot()` / `toMatchInlineSnapshot()` with no behavioral assertions | TS only |

### Language-Specific Implementation Notes

#### TypeScript/JS (ESLint)

- Plugin is a CommonJS module (`module.exports = { rules: { ... } }`)
- Imported in `eslint.config.mjs` via relative path: `import anvilPlugin from './tools/lint-rules/plugin.js'`
- Cross-file rules (RULE-07, TEST-04) use `fs.existsSync` and `fs.readFileSync` within the rule's `Program` visitor
- AST node types: `CatchClause`, `TryStatement`, `CallExpression`, `ExportNamedDeclaration`, `TSTypeAliasDeclaration`, `TSInterfaceDeclaration`, etc.

#### Go (go vet -vettool)

- All analyzers combined into a single binary using `golang.org/x/tools/go/analysis/multichecker` (not singlechecker)
- One binary, one pass over the codebase (14 analyzers in parallel, not 14 separate `go vet` invocations)
- Built via `go build -o bin/anvil-lint ./cmd/anvil-lint` in the project's `tools/go-analyzers/` directory
- `cmd/anvil-lint/main.go` calls `multichecker.Main(analyzer1, analyzer2, ...)` with all 14 analyzers
- Invoked via `go vet -vettool=./tools/go-analyzers/bin/anvil-lint ./...`
- Makefile target builds the binary on first lint run; skips rebuild if binary exists and is newer than source (timestamp check via Make prerequisites)
- If the Go analyzer build fails, `make lint` exits with a clear error message pointing to `tools/go-analyzers/` with manual build instructions
- AST analysis via `go/ast`, `go/types` packages
- Cross-file: Go analyzers naturally analyze packages (multiple files)

**Go error detection:** Go analyzers must use `go/types` (`types.Info`) to identify error values — not pattern matching on variable names like `err`. The `types.Info.Types` map resolves expression types; check if the type implements the `error` interface. This correctly handles renamed error variables (`if e := doSomething(); e != nil`), multiple return values, and custom error types.

#### Python (Flake8)

- Plugin registered via `setup.cfg` entry points under `flake8.extension`
- Error codes use `ANV` prefix: `ANV001` (no-log-and-continue), `ANV002` (no-error-obscuring), etc.
- Installed via `uv pip install -e tools/flake8-plugin/`
- AST analysis via Python's built-in `ast` module
- Cross-file: checker receives `filename` parameter; can read sibling files with `os.path` + `open()`
- **Export detection:** If `__all__` exists in module, use it. Otherwise, names without `_` prefix = exported. (D-25)

#### Test File Mapping Conventions (RULE-07) (D-54)

**TS/JS test file mapping (RULE-07):**
For source file `src/{path}/{name}.ts` (or `.js`/`.mjs`), the rule checks for:
1. `src/{path}/{name}.test.ts` or `src/{path}/{name}.test.js` (co-located)
2. `src/{path}/__tests__/{name}.test.ts` or `src/{path}/__tests__/{name}.test.js` (jest-style)

The rule matches regardless of TS/JS extension — a `.ts` test satisfies a `.js` source file and vice versa.

**Go test file mapping (RULE-07):**
For source file `{path}/{name}.go`, the rule checks for:
1. `{path}/{name}_test.go` (same directory — Go convention)

**Python test file mapping (RULE-07):**
For source file `src/{module-path}/{name}.py`, the rule checks for:
1. `tests/{module-path}/test_{name}.py` (mirrored directory — required for files inside a module path)
2. `tests/test_{name}.py` (flat test directory — only accepted for top-level source files, i.e. `src/{name}.py` with no intermediate directories)

The flat layout is intentionally restricted to top-level sources to avoid false-satisfaction: for example, `src/foo/utils.py` and `src/bar/utils.py` must not both be satisfied by a single `tests/test_utils.py`. Each requires its own mirrored test file (`tests/foo/test_utils.py` and `tests/bar/test_utils.py`). For nested sources like `src/foo/bar/utils.py`, the required test is `tests/foo/bar/test_utils.py`.

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
        // ... all 14 analyzers
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

| Category | Language | Implementations |
|----------|----------|-----------------|
| Anti-Slop | TS/JS | 9 ESLint rules + plugin entry |
| Anti-Slop | Go | 8 analyzers |
| Anti-Slop | Python | `anti_slop.py` with 8 checkers |
| Structural | TS/JS | 6 ESLint rules |
| Structural | Go | 2 analyzers (STRUCT-01 file length + STRUCT-08; STRUCT-03..06 are scaffold-only per D-47) |
| Structural | Python | `structural.py` with 8 checkers |
| Test Quality | TS/JS | 5 ESLint rules |
| Test Quality | Go | 4 analyzers |
| Test Quality | Python | `test_quality.py` with 4 checkers |

Total: 20 ESLint rules, 14 Go analyzers, 20 Flake8 checkers = **54 implementations** of **22 unique rules** (STRUCT-07 not implemented for Go; STRUCT-01/02 are config-driven for TS/JS per D-36; Go STRUCT-01 is a custom analyzer (golangci-lint has no file-length linter), Go STRUCT-02 is config-driven via `funlen`; custom Flake8 checkers for Python STRUCT-01/02; STRUCT-03..06 are scaffold-only for Go per D-47).

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
