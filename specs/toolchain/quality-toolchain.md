# Quality Toolchain Configuration

## Traceability

- **Shared Key**: `quality-toolchain`
- **Spec Path**: `specs/toolchain/quality-toolchain.md`
- **Requirement Refs**: `CONFIG-01` through `CONFIG-03`, `QUAL-01` through `QUAL-05`, `SEC-01`, `SEC-02`, `TYPE-01`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-10, D-18, D-28, D-35, D-36, D-38, D-47, D-55, D-57, D-58)

## Problem Statement

Custom lint rules catch slop patterns, but they're not enough. Agents also need:
- Aggressive built-in lint configs that enforce strict coding standards
- Code coverage to verify tests actually exercise the code
- Mutation testing to verify tests actually catch bugs
- Dead code detection to prevent accumulation of unused code
- CRAP scoring to identify complex, poorly-tested functions
- Security linting to catch common vulnerabilities
- Type checking to catch type errors before runtime
- Dependency auditing to flag known vulnerabilities

These tools must be pre-configured and wired into a unified Makefile interface with three feedback tiers: pre-commit hook (<30s), pre-push hook (<5min), and on-demand quality gate.

## Scope

### In Scope

- Aggressive lint configuration per language (CONFIG-01 through CONFIG-03)
- Coverage configuration and threshold enforcement (QUAL-01)
- Mutation testing configuration (QUAL-02)
- Dead code detection configuration (QUAL-03)
- CRAP score pipeline (QUAL-04)
- Dependency auditing (QUAL-05)
- Security lint rules (SEC-01)
- Secret scanning (SEC-02)
- Type checking (TYPE-01)
- Unified Makefile with all targets
- Feedback tier assignment (which tools run when)

### Out of Scope

- Custom tool development (except CRAP script)
- Tool installation (doctor handles this)
- IDE integration for these tools

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Python type checker | mypy (strict mode) | `[user]` D-10 |
| Pre-commit framework | pre-commit (not husky) | `[decision]` D-18 |
| Mutation testing tier | On-demand via `make quality`; AGENTS.md instructs "run before marking work complete" | `[decision]` D-38 |
| CRAP score implementation | Custom zero-dep script (TS/JS, Go); pytest-crap (Python) | `[research]` |
| Coverage thresholds | 80% line, 70% branch (configurable). Go: line-only (no branch coverage tooling). | `[decision]` |

## Architecture

### Tool Matrix

| Category | TS/JS | Go | Python |
|----------|-------|-----|--------|
| **Lint (built-in)** | ESLint v9+ strict | golangci-lint | Ruff |
| **Lint (custom)** | ESLint local plugin | go vet -vettool | Flake8 plugin |
| **Format** | Prettier | gofmt | Ruff format |
| **Type check** | tsc --noEmit (strict) | go vet + staticcheck | mypy (strict) |
| **Test** | Vitest | go test | pytest |
| **Coverage** | Vitest --coverage (v8) | go test -coverprofile (line only) | pytest-cov |
| **Mutation** | StrykerJS | go-mutesting | mutmut |
| **Dead code** | Knip | deadcode | Vulture |
| **CRAP score** | Custom script | Custom script | pytest-crap |
| **Security** | eslint-plugin-security | gosec (via golangci-lint) | Bandit S rules (via Ruff) |
| **Dep audit** | npm audit / pnpm audit / yarn audit | govulncheck | pip-audit |

> **Note:** Bun does not provide a `bun audit` command. For Bun projects, the Makefile uses `$(PKG_EXEC) better-npm-audit audit` instead. `better-npm-audit` is included as a devDependency for Bun projects (D-58).
| **Secret scan** | gitleaks | gitleaks | gitleaks |

### Feedback Tiers

```
┌────────────────────────────────────────────────────────┐
│                  Tier 1: pre-commit hook (<30s)         │
│                  Safety net — fires on git commit       │
│                                                         │
│  • Lint (built-in + custom rules)                      │
│  • Format check                                         │
│  • Type check                                           │
│  • Secret scan (gitleaks on staged files)               │
└────────────────────────┬───────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────┐
│                  Tier 2: pre-push hook (<5min)          │
│                  Safety net — fires on git push         │
│                                                         │
│  • All Tier 1 checks                                   │
│  • Tests with coverage                                  │
│  • Dead code detection                                  │
│  • CRAP score analysis                                  │
│  • Dependency audit                                     │
│  • Coverage threshold enforcement                       │
└────────────────────────┬───────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────┐
│               Tier 3: on-demand (make quality)          │
│               AGENTS.md: "run before marking done"      │
│                                                         │
│  • All Tier 2 checks                                   │
│  • Mutation testing                                     │
│  • Full CRAP report                                     │
└─────────────────────────────────────────────────────────┘

Agent workflow (driven by AGENTS.md, not hooks):
  • make lint    → fast inner loop feedback, run often during development
  • make check   → Tier 1 + Tier 2, run before considering work done
  • make quality → All tiers including mutation, run before marking complete

Hooks are SAFETY NETS — they catch things agents/humans forgot.
Make targets are the PRIMARY INTERFACE — agents actively run these.
  • Pre-commit hook runs Tier 1 on commit (fast safety net)
  • Pre-push hook runs Tier 2 checks on push (slower safety net)
  • make check = Tier 1 + Tier 2 = what agents run proactively
  • make quality adds mutation testing (Tier 3)
CI is not generated — users add their own if needed.
make check is CI-ready by design.
```

### Makefile Interface

```makefile
# Tier 1 — pre-commit hook
lint:           ## Run all linters (built-in + custom)
format:         ## Check formatting
typecheck:      ## Run type checker
security:       ## Run gitleaks secret scan (security lint rules are part of 'make lint')

# Tier 2 — pre-push hook
test:           ## Run tests with coverage
coverage:       ## Run tests + enforce coverage thresholds
deadcode:       ## Detect unused code
crap:           ## Compute CRAP scores
audit:          ## Audit dependencies for vulnerabilities

# Tier 3 — on-demand (AGENTS.md: "run before marking done")
mutate:         ## Run mutation testing
quality:        ## Run ALL checks (tier 1 + 2 + 3)

# Convenience
check:          ## Run tier 1 + tier 2 (pre-push equivalent, what agents run)
fix:            ## Auto-fix lint + format issues
```

**`make check` semantics:** `make check` runs all Tier 1 + Tier 2 checks sequentially. It is designed to be the single command for both agents and CI. Its exit code is 0 only if ALL checks pass.

### Concrete Make Target Commands Per Language

All JS tooling is invoked via `$(PKG_EXEC)` — a Make variable assigned at scaffold time based on the detected package manager:

```makefile
# PKG_EXEC := bunx        (if bun)
# PKG_EXEC := npx         (if npm)
# PKG_EXEC := pnpm exec   (if pnpm)
# PKG_EXEC := yarn exec   (if yarn)
# Users can override: make lint PKG_EXEC=npx
```

**TypeScript/JS:**
```bash
# Tier 1
lint:      $(PKG_EXEC) eslint .
format:    $(PKG_EXEC) prettier --check .
typecheck: $(PKG_EXEC) tsc --noEmit
# Tier 2
test:      $(PKG_EXEC) vitest run
coverage:  $(PKG_EXEC) vitest run --coverage  # thresholds in vitest.config
deadcode:  $(PKG_EXEC) knip
crap:      $(PKG_EXEC) tsx scripts/crap-report.ts
audit:     $(PKG_EXEC) better-npm-audit audit  # hard-fail on high/critical (D-58, D-60)
# Tier 3
mutate:    $(PKG_EXEC) stryker run
# Convenience
fix:       $(PKG_EXEC) eslint . --fix && $(PKG_EXEC) prettier --write .
```

**Go:**
```bash
# Tier 1
lint:      golangci-lint run ./... && \
           make -C tools/go-analyzers build && \
           go vet -vettool=tools/go-analyzers/bin/anvil-lint ./...
format:    gofmt -l . | (! grep .)
typecheck: go vet ./... && staticcheck ./...
# Tier 2
test:      go test ./...
coverage:  go test -coverprofile=coverage.out ./... && \
           go tool cover -func=coverage.out | scripts/check-coverage.sh
deadcode:  deadcode ./...
crap:      go run ./tools/go-analyzers/cmd/crap-report
audit:     govulncheck ./...  # hard-fail on any finding
# Tier 3
mutate:    go run github.com/zimmski/go-mutesting/cmd/go-mutesting ./...
# Convenience
fix:       gofmt -w . && golangci-lint run --fix ./...
```

**Python:**
```bash
# Tier 1
lint:      uv pip install -e tools/flake8-plugin/ --quiet && \
           uv run ruff check . && \
           uv run flake8 --select=ANV src tests
format:    uv run ruff format --check .
typecheck: uv run mypy src
# Tier 2
COVERAGE_THRESHOLD ?= 80   # line coverage % (override per project: COVERAGE_THRESHOLD=90 make coverage)
test:      uv run pytest
coverage:  uv run pytest --cov=src --cov-fail-under=$(COVERAGE_THRESHOLD)
deadcode:  uv run vulture src
crap:      uv run python scripts/crap_report.py
audit:     uv run pip-audit  # hard-fail on any finding
# Tier 3
mutate:    uv run mutmut run
# Convenience
fix:       uv run ruff check --fix . && uv run ruff format .
```

Python commands use `uv run` to handle virtualenv transparently and avoid PEP 668 issues (D-28). The `--select=ANV` flag ensures Flake8 only runs custom anvil rules, avoiding duplicate warnings with Ruff. `make check` is the aggregate of Tier 1 + Tier 2 targets.

### `make security` Clarification

Security lint rules (eslint-plugin-security, gosec, Bandit S rules) are included in the aggressive lint config and run as part of `make lint`. The `make security` target runs **only** the secret scanning tool (gitleaks) for cases where you want a quick secrets-only check without full lint.

### Aggressive Lint Configs

#### TypeScript/JS (CONFIG-01)

ESLint config enables:
- `@typescript-eslint/strict-type-checked` preset
- `no-explicit-any` (error)
- `no-floating-promises` (error)
- `no-console` (error — use structured logging)
- `@typescript-eslint/strict-boolean-expressions` (warn)
- `import/order` with alphabetical sorting
- `prefer-const` (error)
- `no-restricted-syntax` for common anti-patterns
- `eslint-plugin-security` rules
- All anvil custom rules (error)

#### Go (CONFIG-02)

golangci-lint config enables:
- `errcheck` — unchecked errors
- `goerr113` — error wrapping
- `gocognit` — cognitive complexity (max 15)
- `exhaustive` — exhaustive switch/select
- `gosec` — security rules
- `govet` with shadow check
- `unused` — unused code
- `gochecknoinits` — no init() functions
- `gochecknoglobals` — no global variables
- `revive` — opinionated linter
- `staticcheck` — advanced static analysis
- `funlen` — function length (lines: 80) — covers STRUCT-02 at error threshold (D-36). `statements` limit is intentionally omitted so `funlen` aligns 1:1 with the 80-line rule; statement count is not a STRUCT-02 criterion.

**Note on Go file length (STRUCT-01, D-36):** golangci-lint has no built-in file-length linter. `funlen` covers function length only. Go file length enforcement uses a custom analyzer in the `anvil-lint` binary (the same binary that hosts custom go vet analyzers). This parallels the TS/JS approach (ESLint `max-lines`) and Python approach (custom Flake8 checker). See the lint-rules spec for implementation details.

#### Python (CONFIG-03)

Ruff config enables rule sets:
- `E` — pycodestyle errors
- `W` — pycodestyle warnings
- `F` — pyflakes
- `I` — isort (import sorting)
- `N` — pep8-naming
- `UP` — pyupgrade
- `BLE` — blind except
- `S` — Bandit security
- `C90` — mccabe complexity (max 10)
- `SIM` — simplify
- `PIE` — flake8-pie
- `PT` — pytest style
- `PTH` — pathlib preference
- `RUF` — Ruff-specific
- `D` — pydocstyle (numpy convention)

### CRAP Score Pipeline

For TS/JS and Go, CRAP is computed via a custom zero-dependency script:

```
CRAP(fn) = complexity² × (1 - coverage)³ + complexity
```

**TS/JS pipeline:**
1. Run `vitest run --coverage` with `coverage.provider: 'v8'` and `coverage.reporter: ['json']` configured in `vitest.config.ts` → produces `coverage/coverage-final.json`
2. Parse coverage JSON (Istanbul format): each file entry has `fnMap` (function definitions with names/locations), `f` (function hit counts), `statementMap` (statement locations), `s` (statement hit counts), `branchMap` (branch locations), `b` (branch hit counts — arrays for each branch arm)
3. For each function: compute coverage by line-range containment (statements + branches within function's line range)
4. Compute cyclomatic complexity via lexical keyword counting (`if`, `for`, `while`, `do-while`, `switch`, `case`, `catch`, `&&`, `||`, `? :` (ternary))
5. Calculate CRAP score per function
6. Flag functions with CRAP > 30 (warn) or CRAP > 45 (error)

**Go pipeline:**
1. Run `go test -coverprofile=coverage.out`
2. Parse `coverage.out` for per-line coverage
3. Parse Go source with `go/ast` for function boundaries and complexity
4. Same CRAP formula

**Python:** Use `pytest-crap` which does this natively.

### Pre-commit Configuration

**Note:** Type checking (`tsc --noEmit`, `mypy`) can take 10-30+ seconds on medium-to-large projects, which may exceed the <30s inner loop target. If type checking is slow, users can remove the `typecheck` hook from pre-commit and rely on `make check` instead. The generated `.pre-commit-config.yaml` includes a comment documenting this trade-off.

```yaml
default_install_hook_types: [pre-commit, pre-push]
repos:
  - repo: local
    hooks:
      # Tier 1 — pre-commit (<30s)
      - id: lint
        name: lint
        entry: make lint
        language: system
        pass_filenames: false
        stages: [pre-commit]
      - id: format
        name: format
        entry: make format
        language: system
        pass_filenames: false
        stages: [pre-commit]
      - id: typecheck
        name: typecheck
        entry: make typecheck
        language: system
        pass_filenames: false
        stages: [pre-commit]
      # Tier 2 — pre-push (<5min)
      - id: check
        name: check (tests + coverage + deadcode + CRAP + audit)
        entry: make check
        language: system
        pass_filenames: false
        stages: [pre-push]
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
        stages: [pre-commit]
```

**Pre-push hook installation:** By default, `pre-commit install` only installs the pre-commit hook. The `default_install_hook_types: [pre-commit, pre-push]` key in `.pre-commit-config.yaml` ensures `pre-commit install` sets up both hooks automatically. Anvil uses this approach so that the post-scaffold step only needs to run `pre-commit install` (no extra `--hook-type pre-push` flag).

## What Changes

### New Artifacts

| Artifact | Description |
|----------|-------------|
| `eslint.config.mjs` | Aggressive ESLint config (TS projects) |
| `.golangci.yml` | Aggressive golangci-lint config (Go projects) |
| `pyproject.toml [tool.ruff]` | Aggressive Ruff config (Python projects) |
| `mypy.ini` or `pyproject.toml [tool.mypy]` | Strict mypy config (Python projects) |
| `Makefile` | Unified make targets for all tiers |
| `.pre-commit-config.yaml` | Pre-commit hooks config |
| `tools/crap-score.ts` (TS/JS) or `tools/go-analyzers/cmd/crap-report/main.go` (Go) or `tools/crap-score.py` (Python) | CRAP score computation script |
| `knip.json` | Knip dead code config (TS projects) |
| `stryker.config.mjs` | StrykerJS config (TS projects) |
| `.gitleaks.toml` | Gitleaks config |

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Aggressive lint config too strict for some codebases | Medium | Medium | Rules are individually disable-able. Default config is a starting point. |
| Mutation testing too slow even as on-demand | Medium | Low | Configure to mutate only changed files. Document expected run times. |
| CRAP complexity scanner inaccurate (lexical vs AST) | Low | Low | Lexical counting is close enough. Learning test LT5 validated approach. |
| coverage tool versions conflict | Low | Medium | Pin tool versions in lockfile. Doctor checks compatibility. |

## Testing Strategy

### Config Validation Tests
- Each generated config is syntactically valid (load it with the tool and verify no parse errors)
- Seed code passes all lint rules with the aggressive config

### Makefile Integration Tests
- Each make target exits 0 on clean seed code
- Each make target exits non-zero when violation is introduced

### CRAP Score Tests
- Unit test the CRAP calculation function
- Integration test: feed a function with known complexity + coverage → verify score
- Snapshot test: CRAP report on seed code matches expected output
