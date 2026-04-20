# Requirements

## v1 — Must Ship

### CLI (CLI-xx)

- **CLI-01**: `anvil init --lang <golang|typescript|python>` scaffolds a project with all tooling for selected languages. Files go directly into standard project locations (no managed directory). For TS/JS projects, detects package manager from existing lockfiles (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`); prompts if not detected (D-29). The `typescript` language flag supports both TypeScript and JavaScript projects — detection heuristics adapt output based on existing code (D-31). JS-only project detection deferred to v2 (D-46); v1 generates TypeScript config that handles .js files natively.
- ~~**CLI-02**: `anvil update`~~ — **Deferred to v2 (D-39).** Users re-run `anvil init` for idempotent re-scaffold. FsTree auto-classifies changes (CREATE/UPDATE) and prompts for modified files only.
- **CLI-03**: `anvil doctor` verifies lint/quality config health, reports misconfigurations, and auto-fixes non-destructive issues (missing config keys, gitignore entries). Reports but does not auto-fix destructive changes.
- **CLI-04**: `anvil init` on existing projects detects application code via language-aware heuristics (Go: .go files/go.mod; TS: .ts/.js files/package.json; Python: .py files/__init__.py) and skips seed code generation. Adds tooling with conflict prompts.
- **CLI-05**: `anvil init --non-interactive` runs scaffold without prompts. Also activates when stdin is not a TTY (D-56). All conflict prompts default to "skip" (never overwrite without explicit consent). Enables headless/CI usage.
- **CLI-06**: `anvil init --dry-run` previews all changes without writing to disk. Powered by FsTree — renders all files in memory, classifies changes, and prints the summary.
- **CLI-07**: `anvil --version` prints the anvil version and exits. No subcommand — standard `--version` flag only.

### Exit Codes

| Command | Code | Meaning |
|---------|------|---------|
| `anvil init` | 0 | Scaffold succeeded (includes "nothing to do" and skipped files) |
| `anvil init` | 1 | Scaffold failed (abort, render error, partial flush, language mismatch) |
| `anvil init --dry-run` | 0 | Preview printed |
| `anvil doctor` | 0 | All checks passed (may include auto-fixes) |
| `anvil doctor` | 1 | Unresolvable issues found (missing tools, checksum drift) |
| `anvil --version` | 0 | Version printed |

### CLI Target Directory

All commands operate on the current working directory. There is no `--target-dir` flag in v1. `ScaffoldContext.targetDir` is always `process.cwd()`.

### Custom Lint Rules — Anti-Slop (RULE-xx)

- **RULE-01**: `no-log-and-continue` — catch/except blocks that only log and continue execution. TS/JS, Go, Python.
- **RULE-02**: `no-error-obscuring` — catch blocks that return default values or throw generic errors. TS/JS, Go, Python.
- **RULE-03**: `no-placeholder-comments` — regex-based detection of vague future-work comments. TS/JS, Go, Python.
- **RULE-04**: `no-pass-through-wrapper` — functions whose body is a single return of another function with same args. TS/JS, Go, Python.
- **RULE-05**: `no-log-and-throw` — log + throw/return-error in the same block (duplicate error reporting). TS/JS, Go, Python.
- **RULE-06**: `require-structured-logging` — ban template literals/string interpolation in log calls. TS/JS, Go, Python.
- **RULE-07**: `require-test-files` — every source file must have a corresponding test file. Exempts: declaration-only files (`types`, `errors`, `constants`, `enums`); entry points (Go `cmd/**/main.go`, TS/JS `index.ts`/`index.js`/`index.mjs` at any directory level (barrel files), Python `__main__.py`). Source directories configurable per lint config; defaults: TS→`src/`, Go→`internal/`+`pkg/`, Python→`src/` (D-34). TS/JS, Go, Python.
- **RULE-08**: `no-async-noise` — redundant return-await, async functions that never await. TS/JS only.
- **RULE-09**: `no-silent-error-swallow` — empty catch/except blocks with no handling (no logging, no re-throw, no comment). Different from RULE-01 (which catches log-only handling). TS/JS, Go, Python.

### Custom Lint Rules — Structural (STRUCT-xx)

- **STRUCT-01**: Max file length (language-tuned: TS 400, Go 500, Python 350 — error threshold). TS/JS: ESLint `max-lines` (config-driven); Go: custom analyzer in `anvil-lint` binary (golangci-lint has no file-length linter); Python: custom Flake8 checker. Configurable per-language. (D-36)
- **STRUCT-02**: Max function length (80 lines — error threshold). TS/JS: ESLint `max-lines-per-function` (config-driven); Go: `funlen` in golangci-lint (config-driven); Python: custom Flake8 checker. (D-36)
- **STRUCT-03**: File organization — **exported** types in `types.{ext}` (Factory approach: non-exported types stay wherever). TS/JS, Python. Go: scaffold-only (D-47).
- **STRUCT-04**: File organization — **exported** error classes/types in `errors.{ext}`. TS/JS, Python. Go: scaffold-only (D-47).
- **STRUCT-05**: File organization — **exported** constants in `constants.{ext}`. TS/JS, Python. Go: scaffold-only (D-47).
- **STRUCT-06**: File organization — **exported** enums in `enums.{ext}`. TS/JS, Python. Go: scaffold-only (D-47).
- **STRUCT-07**: Filename matches export name for single-export files. Files with multiple exports are exempt. (D-48) TS/JS, Python only (dropped for Go — multiple exports at package scope make "primary export" undefined; see D-30).
- **STRUCT-08**: No exported function expressions (use declarations). TS: `export const fn = () => {}` → `export function fn() {}`. Go: `var Fn = func(){}` → `func Fn(){}`. Python: `fn = lambda:` → `def fn():`. TS/JS, Go, Python.

### Custom Lint Rules — Test Quality (TEST-xx)

- **TEST-01**: `no-empty-tests` — test functions with no assertions. TS/JS, Go, Python.
- **TEST-02**: `no-tautological-assertions` — assertions on constants (e.g., `expect(true).toBe(true)`). TS/JS, Go, Python.
- **TEST-03**: `no-disabled-tests-without-reason` — `.skip`/`t.Skip` without explanation. TS/JS, Go, Python.
- **TEST-04**: `require-error-path-tests` — source has error handling but test has zero error-path assertions. TS/JS, Go, Python.
- **TEST-05**: `no-snapshot-only-tests` — test file uses only snapshot assertions. TS/JS only.

### Aggressive Lint Config (CONFIG-xx)

- **CONFIG-01**: TS/JS — ESLint config with no-any, no-floating-promises, no-console, import-order, prefer-const, no-restricted-syntax, strict-boolean-expressions, security rules (`eslint-plugin-security`). Barrel files (`index.ts`/`index.js` re-export files) are allowed as organizational convention (D-52/D-57); `eslint-plugin-barrel-files` removed (D-57) to avoid contradicting RULE-07's exemption.
- **CONFIG-02**: Go — golangci-lint config with errcheck, goerr113, gocognit, exhaustive, gosec, govet shadow, unused, gochecknoinits, gochecknoglobals, revive, staticcheck.
- **CONFIG-03**: Python — Ruff config with E, W, F, I, N, UP, BLE, S, C90, SIM, PIE, PT, PTH, RUF, D rule sets.

### Quality Toolchain (QUAL-xx)

- **QUAL-01**: Coverage — configured per language (Vitest/v8, go test -cover, pytest-cov) with threshold enforcement. Go: line coverage only (no branch coverage tooling); branch coverage guidance in AGENTS.md.
- **QUAL-02**: Mutation testing — configured per language (StrykerJS, go-mutesting, mutmut) as on-demand quality gate.
- **QUAL-03**: Dead code detection — configured per language (Knip, deadcode, Vulture) in pre-push hook.
- **QUAL-04**: CRAP score — per-function scoring script (custom for TS/JS and Go; pytest-crap for Python) in pre-push hook.
- **QUAL-05**: Dependency auditing — npm/pnpm/yarn audit, govulncheck, pip-audit in pre-push hook. Bun projects use `$(PKG_EXEC) better-npm-audit audit` (i.e. `bunx better-npm-audit audit`); `better-npm-audit` is added as a devDependency for Bun projects (D-58).

### Security (SEC-xx)

- **SEC-01**: Security lint rules configured per language (eslint-plugin-security, gosec, Bandit/S rules via Ruff).
- **SEC-02**: Secret scanning via gitleaks in pre-commit hooks.

### Type Checking (TYPE-xx)

- **TYPE-01**: Type checker configured per language (tsc --noEmit strict, go vet + staticcheck, mypy strict) in pre-commit hook. For JavaScript (non-TS) projects, the scaffolded `tsconfig.json` sets `allowJs: true, checkJs: true, noEmit: true` so `tsc` type-checks `.js` files via JSDoc; pure-JS projects without type annotations will only catch syntactic and import errors, which is accepted (D-47 keeps JS support minimal in v1).

### Scaffold Output (SCAF-xx)

- **SCAF-01**: Seed code — exemplar `seed` module per language demonstrating all conventions. Passes all lint rules.
- **SCAF-02**: AGENTS.md — concise agent instructions covering validation, reference code, rules, testing, dependencies.
- **SCAF-03**: Makefile — unified targets: lint, format, test, typecheck, security, coverage, deadcode, crap, mutate, quality, audit, check, fix.
- **SCAF-04**: Pre-commit and pre-push config — per-language hooks via pre-commit framework. Pre-commit: lint, format, typecheck, secrets (Tier 1). Pre-push: `make check` which runs Tier 1 + Tier 2 (tests, coverage, deadcode, CRAP, audit) — intentionally re-runs Tier 1 as a safety net.
- ~~**SCAF-05**: CI workflows~~ — **Dropped (D-38).** anvil owns the dev environment, not deployment infrastructure. Users add their own CI if needed (`make check` is CI-ready by design).
- **SCAF-06**: Project hygiene — .gitignore, .editorconfig, .gitleaks.toml, README.md template.
- **SCAF-07**: `.anvil.lock` manifest — tracks anvil version, generated files, and checksums for idempotent re-scaffold detection.

## v2 — Deferred

- **D-01**: Additional languages (Rust, Java, C#) — significant scope; validate v1 model first.
- **D-02**: IDE integration plugins (VSCode, GoLand, PyCharm) — valuable but not core.
- **D-03**: Agent skill for test-first workflow enforcement — judgment-based, separate concern from static tooling.
- **D-04**: `anvil migrate` for adding a language to an existing anvil project — complex merging logic.
- **D-05**: Config presets (strict, moderate, minimal) — v1 ships opinionated defaults only.
- **D-06**: `anvil eject [component]` — partial eject per component. Not needed in v1 since files are directly scaffolded.
- **D-07**: `anvil update` command with 3-way merge — deferred from v1 (D-39). Re-scaffold via `anvil init` covers the common case.
- **D-08**: JS-only project support (D-31/D-46) — TS-first for v1; JS-only detection deferred.

## Out of Scope

- **Authorship detection** — anvil prevents slop, doesn't detect who wrote it.
- **Runtime analysis** — all checks are static / offline.
- **Package publishing** — rules are bundled locally, not published to registries.
- **Framework-specific rules** (React, Next.js, Express) — too opinionated for a scaffold.
- **Dep count enforcement** — prefer stdlib guidance in AGENTS.md, no hard limits.
