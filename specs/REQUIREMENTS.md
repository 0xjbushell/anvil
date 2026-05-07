# Requirements

## v1 — Must Ship

### CLI (CLI-xx)

- **CLI-01**: `anvil init --lang <golang|typescript|python>` scaffolds a project with all tooling for selected languages. Files go directly into standard project locations (no managed directory). For TS/JS projects, detects package manager from existing lockfiles (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`); prompts if not detected (D-29). The `typescript` language flag supports both TypeScript and JavaScript projects — detection heuristics adapt output based on existing code (D-31). JS-only project detection deferred to v2 (D-46); v1 generates TypeScript config that handles .js files natively. Toolchain versions (Bun, Node, Go, Python) are resolved at init time per D-64 and recorded in `.anvil.lock` — no hardcoded floors in templates.
- ~~**CLI-02**: `anvil update`~~ — **Deferred to v2 (D-39).** Users re-run `anvil init` for idempotent re-scaffold. FsTree auto-classifies changes (CREATE/UPDATE) and prompts for modified files only.
- **CLI-03**: `anvil doctor` verifies lint/quality config health, reports misconfigurations, and auto-fixes non-destructive issues (missing config keys, gitignore entries). Reports but does not auto-fix destructive changes.
- **CLI-04**: `anvil init` on existing projects detects application code via language-aware heuristics (Go: .go files/go.mod; TS: .ts/.js files/package.json; Python: .py files/__init__.py) and skips seed code generation. Adds tooling with conflict prompts.
- **CLI-05**: `anvil init --non-interactive` runs scaffold without prompts (explicit opt-in only — pipe-without-flag is an error, not a silent mode switch; D-67 supersedes D-56). Setup prompts resolve via detected → lockfile → safe default. **Conflicts trigger a structured diff report on stderr and exit non-zero with no files written** (all-or-nothing); the agent edits/deletes/leaves the conflicting files and re-runs. Enables headless and agent usage.
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
- **STRUCT-09**: `no-barrel-density` — `index.{ts,js,mjs,tsx}` files dominated by re-exports (≥3 `export … from` statements AND >80% of top-level statements are re-exports). Pure file-local AST. TS/JS only. (D-62)
- **STRUCT-10**: `no-over-fragmentation` — directories dominated by tiny single-purpose files (≥4 source files, ≥60% are <30 LOC with ≤1 export). ESLint sentinel pattern with `fs` reads; allowlist: `icons`, `assets`, `__generated__`, `migrations` (configurable). TS/JS only. (D-63)

### Custom Lint Rules — Test Quality (TEST-xx)

- **TEST-01**: `no-empty-tests` — test functions with no assertions. TS/JS, Go, Python.
- **TEST-02**: `no-tautological-assertions` — assertions on constants (e.g., `expect(true).toBe(true)`). TS/JS, Go, Python.
- **TEST-03**: `no-disabled-tests-without-reason` — `.skip`/`t.Skip` without explanation. TS/JS, Go, Python.
- **TEST-04**: `require-error-path-tests` — source has error handling but test has zero error-path assertions. TS/JS, Go, Python.
- **TEST-05**: `no-snapshot-only-tests` — test file uses only snapshot assertions. TS/JS only.

### Aggressive Lint Config (CONFIG-xx)

- **CONFIG-01**: TS/JS — ESLint config with no-any, no-floating-promises, no-console, import-order, prefer-const, no-restricted-syntax, strict-boolean-expressions, security rules (`eslint-plugin-security`). Barrel files (`index.ts`/`index.js` re-export files) are allowed as organizational convention (D-52/D-57); `eslint-plugin-barrel-files` removed (D-57) to avoid contradicting RULE-07's exemption.
- **CONFIG-02**: Go — golangci-lint config with errcheck, err113, gocognit, exhaustive, gosec, govet shadow, unused, gochecknoinits, gochecknoglobals, revive, staticcheck.
- **CONFIG-03**: Python — Ruff config with E, W, F, I, N, UP, BLE, S, C90, SIM, PIE, PT, PTH, RUF, D rule sets.

### Quality Toolchain (QUAL-xx)

- **QUAL-01**: Coverage — configured per language (Vitest/v8, go test -cover, pytest-cov) with threshold enforcement. Go: line coverage only (no branch coverage tooling); branch coverage guidance in AGENTS.md.
- **QUAL-02**: Mutation testing — configured per language (StrykerJS, go-mutesting, mutmut) as on-demand quality gate.
- **QUAL-03**: Dead code detection — configured per language (Knip, deadcode, Vulture) in pre-push hook.
- **QUAL-04**: CRAP score — per-function scoring script (custom for TS/JS and Go; pytest-crap for Python) in pre-push hook.
- **QUAL-05**: Dependency auditing — bun/npm/pnpm/yarn audit, govulncheck, pip-audit in pre-push hook. Bun projects use `bun audit --audit-level high` so audits read the Bun lockfile directly and fail on high/critical advisories (D-58).

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
- **SCAF-06**: Project hygiene — .gitignore, .gitattributes (LF line endings, D-70), .editorconfig, .gitleaks.toml, README.md template.
- **SCAF-07**: `.anvil.lock` manifest — tracks anvil version, toolchain versions (D-64), generated files, per-file checksums, and a checkpoint marker (`flushStatus` + per-entry `status`, D-70) for crash-recoverable re-scaffold and idempotent regeneration.

### Development Environments (DEV-xx)

- **DEV-01**: The anvil repository provides a Nix development environment for normal contributor work. It installs the required Anvil validation toolchain rather than relying on mutable host-global setup.
- **DEV-02**: The anvil repository provides a full Nix release-validation environment with Bun, Node, native build tools, Go, Python 3.11+, Make, `uv`, `gitleaks`, `govulncheck`, `golangci-lint`, `staticcheck`, `deadcode`, and all other tools required by supported-language e2e validation.
- **DEV-03**: Required validation tools are hard requirements. Contributor validation, e2e validation, and release validation fail when required tools are missing; tests do not skip supported-language checks because the environment is incomplete.
- **DEV-04**: Contributor entrypoints are idempotent wrapper commands or package scripts that enter the correct Nix environment before running validation. Contributors should not install validation tools manually or assemble bespoke local environments.
- **DEV-05**: Generated projects include purpose-built, language-specific Nix development environments. TypeScript projects receive TypeScript tooling only, Go projects receive Go tooling only, and Python projects receive Python tooling only, plus shared cross-language tools such as `gitleaks` where the generated Makefile requires them.
- **DEV-06**: Generated project Makefiles remain language-specific and strict. `make check` and `make quality` fail clearly if required tools are unavailable; they never silently omit required targets.

### E2E and Sandbox Environments (E2E-xx)

- **E2E-01**: Fixture inputs may define `setup.sh`; the harness executes it after copying the input into the sandbox and before invoking Anvil. Setup failures fail the scenario.
- **E2E-02**: Committed fixture scenarios exercise real scaffold and re-scaffold behavior. `--version`-only scenarios are allowed only when the scenario's explicit purpose is version behavior.
- **E2E-03**: E2E scenarios run inside purpose-built Nix sandbox environments for the target language so tests do not depend on host-global tool installation.
- **E2E-04**: E2E validation fails, rather than skips, when required tools for a supported-language scenario are unavailable.
- **E2E-05**: E2E tests isolate temp directories, caches, home directories, and tool state so full-suite runs are deterministic and do not race on global locks or caches.
- **E2E-06**: `bun agent:check` selects meaningful real scenarios for changed source, template, fixture, and generated-toolchain files. It must not provide false confidence by selecting only smoke scenarios for behavior-changing diffs.
- **E2E-07**: Interactive PTY scenarios cover enough prompts to prove interactive init remains usable. At minimum, TypeScript interactive init is required; Go and Python interactive scenarios are added unless an explicit decision defers them.

### Release Validation and Distribution (REL-xx)

- **REL-01**: Release CI uses the full Nix release-validation environment and treats any required-tool absence or supported-language e2e skip as a failure.
- **REL-02**: Release CI runs the authoritative validation battery from a clean worktree: `bun agent:check`, `bun fixtures`, `bunx tsc --noEmit`, full `bun test`, `bun run build`, generated-project e2e for TypeScript, Go, and Python, and `bun mutation`.
- **REL-03**: Release CI proves the compiled standalone binary can scaffold projects from outside the repository, where repo-relative `static/` and `src/templates/` paths are unavailable.
- **REL-04**: The installer resolves `latest` releases via GitHub's `/releases/latest/download/` endpoint and pinned versions via `/releases/download/<version>/`.
- **REL-05**: The release workflow builds and uploads every binary asset referenced by the installer.
- **REL-06**: Release rehearsal or equivalent CI proof validates installer behavior against the assets that will be published.
- **REL-07**: Release validation verifies tix/spec hygiene for shipped scope: no executable deliverables are accidentally left open, and parent rollups are either reconciled or explicitly documented.

### Public Documentation and Agent-Assisted Adoption (DOC-xx)

- **DOC-01**: Anvil provides a public static documentation site using Astro Starlight and GitHub Pages. The site is built from repository sources and deploys from `main`.
- **DOC-02**: The root `README.md` is a concise public landing page that explains Anvil's purpose, install teaser, docs link, releases link, and contribution/release pointers without duplicating the full docs site.
- **DOC-03**: Human-facing docs cover getting started, installation, CLI reference, how Anvil works, existing-project adoption, using Anvil with coding agents, troubleshooting, language guides for TypeScript/JS, Go, and Python, and practical examples.
- **DOC-04**: The docs site publishes a concise `/start.md` bootstrap prompt for coding agents. It installs/selects Anvil, verifies `anvil --version`, asks whether to install the Anvil agent skill, and provides only a minimal fallback adoption flow.
- **DOC-05**: An installable Anvil agent skill is published as the canonical ongoing operational protocol for coding agents to install/update Anvil, adopt projects, re-scaffold, run `anvil doctor`, validate generated projects, and troubleshoot drift or conflicts.
- **DOC-06**: Agent-facing artifacts are non-overlapping: `/start.md` handles bootstrap only, the Anvil skill handles lifecycle operations, generated `AGENTS.md` handles repo-local coding conventions, and human docs explain rather than duplicate operational protocols.
- **DOC-07**: Generated project READMEs explain Anvil-generated quality gates, seed/reference code, `AGENTS.md`, `.anvil.lock`, and the first validation commands for the selected language.
- **DOC-08**: Documentation and agent protocol changes are validated in CI with a docs build/check and static contract checks for required links, command names, safety rules, and artifact boundaries.

## v2 — Deferred

- **D-01**: Additional languages (Rust, Java, C#) — significant scope; validate v1 model first.
- **D-02**: IDE integration plugins (VSCode, GoLand, PyCharm) — valuable but not core.
- **D-03**: Agent skill for test-first workflow enforcement — judgment-based, separate concern from static tooling. This is distinct from the DOC-05 operational Anvil adoption skill.
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
