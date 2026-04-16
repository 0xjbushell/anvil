# Requirements

## v1 — Must Ship

### CLI (CLI-xx)

- **CLI-01**: `anvil init --lang <golang|typescript|python> [--ci <github|azure|both|none>]` scaffolds a project with all tooling for selected languages. Files go directly into standard project locations (no managed directory). `--ci` defaults to `none` if omitted. For TS/JS projects, detects package manager from existing lockfiles (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`); prompts if not detected (D-29). The `typescript` language flag supports both TypeScript and JavaScript projects — detection heuristics adapt output based on existing code (D-31).
- **CLI-02**: `anvil update [--dry-run] [--force]` diffs `.anvil.lock` against latest templates and applies additive updates. Uses 3-way merge: re-renders original template from lockfile context (base), compares with new template (theirs) and current disk (ours). Refuses major version jumps without `--force`. New upstream files that already exist on disk (untracked) trigger conflict prompts (D-32, D-33).
- **CLI-03**: `anvil doctor` verifies lint/quality config health, reports misconfigurations, and auto-fixes non-destructive issues (missing config keys, gitignore entries). Reports but does not auto-fix destructive changes.
- **CLI-04**: `anvil init` on existing projects detects application code via language-aware heuristics (Go: .go files/go.mod; TS: .ts/.js files/package.json; Python: .py files/__init__.py) and skips seed code generation. Adds tooling with conflict prompts.

### Custom Lint Rules — Anti-Slop (RULE-xx)

- **RULE-01**: `no-log-and-continue` — catch/except blocks that only log and continue execution. TS/JS, Go, Python.
- **RULE-02**: `no-error-obscuring` — catch blocks that return default values or throw generic errors. TS/JS, Go, Python.
- **RULE-03**: `no-placeholder-comments` — regex-based detection of vague future-work comments. TS/JS, Go, Python.
- **RULE-04**: `no-pass-through-wrapper` — functions whose body is a single return of another function with same args. TS/JS, Go, Python.
- **RULE-05**: `no-log-and-throw` — log + throw/return-error in the same block (duplicate error reporting). TS/JS, Go, Python.
- **RULE-06**: `require-structured-logging` — ban template literals/string interpolation in log calls. TS/JS, Go, Python.
- **RULE-07**: `require-test-files` — every source file must have a corresponding test file. Exempts: declaration-only files (`types`, `errors`, `constants`, `enums`); entry points (Go `cmd/**/main.go`, TS root `index.ts`, Python `__main__.py`). Source directories configurable per lint config; defaults: TS→`src/`, Go→`internal/`+`pkg/`, Python→`src/` (D-34). TS/JS, Go, Python.
- **RULE-08**: `no-async-noise` — redundant return-await, async functions that never await. TS/JS only.

### Custom Lint Rules — Structural (STRUCT-xx)

- **STRUCT-01**: Max file length (language-tuned: TS 250/400, Go 350/500, Python 200/350 warn/error). TS/JS: ESLint `max-lines` (config-driven); Go: `funlen` in golangci-lint (config-driven); Python: custom Flake8 checker. Configurable per-language. (D-36)
- **STRUCT-02**: Max function length (50 warn, 80 error). TS/JS: ESLint `max-lines-per-function` (config-driven); Go: `funlen` in golangci-lint (config-driven); Python: custom Flake8 checker. (D-36)
- **STRUCT-03**: File organization — **exported** types in `types.{ext}` (Factory approach: non-exported types stay wherever). TS/JS, Go, Python.
- **STRUCT-04**: File organization — **exported** error classes/types in `errors.{ext}`. TS/JS, Go, Python.
- **STRUCT-05**: File organization — **exported** constants in `constants.{ext}`. TS/JS, Go, Python.
- **STRUCT-06**: File organization — **exported** enums in `enums.{ext}`. TS/JS, Go, Python.
- **STRUCT-07**: Filename matches primary export. TS/JS, Python only (dropped for Go — multiple exports at package scope make "primary export" undefined; see D-30).
- **STRUCT-08**: No exported function expressions (use declarations). TS: `export const fn = () => {}` → `export function fn() {}`. Go: `var Fn = func(){}` → `func Fn(){}`. Python: `fn = lambda:` → `def fn():`. TS/JS, Go, Python.

### Custom Lint Rules — Test Quality (TEST-xx)

- **TEST-01**: `no-empty-tests` — test functions with no assertions. TS/JS, Go, Python.
- **TEST-02**: `no-tautological-assertions` — assertions on constants (e.g., `expect(true).toBe(true)`). TS/JS, Go, Python.
- **TEST-03**: `no-disabled-tests-without-reason` — `.skip`/`t.Skip` without explanation. TS/JS, Go, Python.
- **TEST-04**: `require-error-path-tests` — source has error handling but test has zero error-path assertions. TS/JS, Go, Python.
- **TEST-05**: `no-snapshot-only-tests` — test file uses only snapshot assertions. TS/JS only.

### Aggressive Lint Config (CONFIG-xx)

- **CONFIG-01**: TS/JS — ESLint config with no-any, no-floating-promises, no-console, import-order, prefer-const, no-barrel-files (`eslint-plugin-barrel-files`), no-restricted-syntax, strict-boolean-expressions, security rules (`eslint-plugin-security`).
- **CONFIG-02**: Go — golangci-lint config with errcheck, goerr113, gocognit, exhaustive, gosec, govet shadow, unused, gochecknoinits, gochecknoglobals, revive, staticcheck.
- **CONFIG-03**: Python — Ruff config with E, W, F, I, N, UP, BLE, S, C90, SIM, PIE, PT, PTH, RUF, D rule sets.

### Quality Toolchain (QUAL-xx)

- **QUAL-01**: Coverage — configured per language (Vitest/v8, go test -cover, pytest-cov) with threshold enforcement. Go: line coverage only (no branch coverage tooling); branch coverage guidance in AGENTS.md.
- **QUAL-02**: Mutation testing — configured per language (StrykerJS, go-mutesting, mutmut) as on-demand quality gate.
- **QUAL-03**: Dead code detection — configured per language (Knip, deadcode, Vulture) in CI pipeline.
- **QUAL-04**: CRAP score — per-function scoring script (custom for TS/JS and Go; pytest-crap for Python) in CI pipeline.
- **QUAL-05**: Dependency auditing — npm audit/govulncheck/pip-audit in CI.

### Security (SEC-xx)

- **SEC-01**: Security lint rules configured per language (eslint-plugin-security, gosec, Bandit/S rules via Ruff).
- **SEC-02**: Secret scanning via gitleaks in pre-commit hooks.

### Type Checking (TYPE-xx)

- **TYPE-01**: Type checker configured per language (tsc --noEmit strict, go vet + staticcheck, mypy strict) in inner loop and CI.

### Scaffold Output (SCAF-xx)

- **SCAF-01**: Seed code — exemplar `seed` module per language demonstrating all conventions. Passes all lint rules.
- **SCAF-02**: AGENTS.md — concise agent instructions covering validation, reference code, rules, testing, dependencies.
- **SCAF-03**: Makefile — unified targets: lint, format, test, typecheck, security, coverage, deadcode, crap, mutate, quality, audit.
- **SCAF-04**: Pre-commit config — per-language hooks via pre-commit framework.
- **SCAF-05**: CI workflows — GitHub Actions and/or Azure Pipelines for lint + quality pipeline.
- **SCAF-06**: Project hygiene — .gitignore, .editorconfig, .gitleaks.toml, README.md template.
- **SCAF-07**: `.anvil.lock` manifest — tracks anvil version, generated files, and checksums for `anvil update` diffing.

## v2 — Deferred

- **D-01**: Additional languages (Rust, Java, C#) — significant scope; validate v1 model first.
- **D-02**: IDE integration plugins (VSCode, GoLand, PyCharm) — valuable but not core.
- **D-03**: Agent skill for test-first workflow enforcement — judgment-based, separate concern from static tooling.
- **D-04**: `anvil migrate` for adding a language to an existing anvil project — complex merging logic.
- **D-05**: Config presets (strict, moderate, minimal) — v1 ships opinionated defaults only.
- **D-06**: `anvil eject [component]` — partial eject per component. Not needed in v1 since files are directly scaffolded.

## Out of Scope

- **Authorship detection** — anvil prevents slop, doesn't detect who wrote it.
- **Runtime analysis** — all checks are static / offline.
- **Package publishing** — rules are bundled locally, not published to registries.
- **Framework-specific rules** (React, Next.js, Express) — too opinionated for a scaffold.
- **Dep count enforcement** — prefer stdlib guidance in AGENTS.md, no hard limits.
