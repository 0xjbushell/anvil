# Project Output — Scaffold Artifacts

## Traceability

- **Shared Key**: `project-output`
- **Spec Path**: `specs/scaffold/project-output.md`
- **Requirement Refs**: `SCAF-01..04, SCAF-06..07` (SCAF-05 dropped per D-38)
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-01, D-08, D-13, D-20, D-21, D-28, D-31, D-35, D-37, D-38, D-39, D-40, D-41, D-46, D-47, D-61)

## Problem Statement

When `anvil init` runs, it must produce a project that looks identical to one a senior developer configured manually. Every file must be in its conventional location, every config must be idiomatic for the language, and the seed code must demonstrate all conventions that custom lint rules enforce. The output must teach coding agents by example while being immediately useful to humans.

## Scope

### In Scope

- Seed code modules per language (SCAF-01)
- AGENTS.md template (SCAF-02)
- Makefile with unified targets (SCAF-03) — TS/JS Makefile uses `PKG_EXEC` variable auto-detected from packageManager (npx/bunx/pnpm exec/yarn exec)
- Pre-commit configuration (SCAF-04)
- Pre-commit and pre-push hook configuration (SCAF-04)
- Project hygiene files: .gitignore, .editorconfig, .gitleaks.toml, README.md (SCAF-06)
- .anvil.lock manifest — tracks anvil version, generated files, and checksums for idempotent re-scaffold (SCAF-07)
- File placement conventions per language

### Out of Scope

- IDE-specific configuration (.vscode/, .idea/)
- Docker/containerization files
- Deployment configuration

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Scaffold model | Direct into standard locations | `[user]` D-01 |
| Seed code | Real working `seed` module per language — teaches by existing, no special comments | `[user]` D-20, D-37 |
| AGENTS.md | Under 40 lines, complements lint | `[user]` D-21 |
| Existing project handling | Additive; skip seed if code exists | `[user]` D-08 |
| Enforcement model | Local-first: pre-commit + pre-push hooks; no CI generation | `[user]` D-38 |

## Architecture

### Output File Map

What `anvil init --lang <lang>` generates. Files marked with 📋 are static (copied as-is). Files marked with ⚙️ are generated dynamically (EJS templates or programmatic).

#### TypeScript Project

**Note (D-31, D-46):** The `typescript` language flag supports both TypeScript and JavaScript projects. Seed code is `.ts`-only. ESLint config handles `.js`/`.mjs` files natively. True JS-only support (skipping `tsconfig.json`, omitting type-checked rules) is deferred to v2 (D-46). v1 generates TypeScript config that handles `.js` files natively.

```
project-root/
├── src/
│   └── seed/                   📋 Seed code module (D-37)
│       ├── seed.ts             📋 Main module (function, error handling, structured logging)
│       ├── seed.test.ts        📋 Tests (happy path + error path + edge cases)
│       ├── types.ts            📋 Exported types for the module
│       ├── errors.ts           📋 Custom error classes
│       ├── constants.ts        📋 Module constants
│       └── enums.ts            📋 Module enums
├── tools/
│   ├── lint-rules/             📋 ESLint plugin source
│   │   ├── plugin.js
│   │   ├── anti-slop/
│   │   ├── structural/
│   │   └── test-quality/
│   └── crap-score.ts           📋 CRAP score computation script
├── eslint.config.mjs           ⚙️ ESLint flat config (imports local plugin)
├── tsconfig.json               ⚙️ Strict TypeScript config
├── .prettierrc                 ⚙️ Prettier config (printWidth, semi, tabs)
├── package.json                ⚙️ Dependencies + scripts
├── vitest.config.ts            ⚙️ Vitest config with coverage
├── knip.json                   📋 Dead code detection config
├── stryker.config.mjs          📋 Mutation testing config
├── Makefile                    ⚙️ Unified make targets
├── .pre-commit-config.yaml     ⚙️ Pre-commit + pre-push hooks
├── .gitignore                  ⚙️ Language-specific gitignore
├── .editorconfig               📋 Editor config
├── .gitleaks.toml              📋 Secret scanning config
├── AGENTS.md                   ⚙️ Agent instructions
├── README.md                   ⚙️ Project readme template
└── .anvil.lock                 ⚙️ Anvil provenance manifest
```

#### Go Project

```
project-root/
├── internal/
│   └── seed/                   📋 Seed code module (D-37)
│       ├── seed.go             📋 Main module
│       ├── seed_test.go        📋 Tests
│       ├── types.go            📋 Exported types
│       ├── errors.go           📋 Custom error types
│       ├── constants.go        📋 Module constants
│       └── enums.go            📋 Module enums
├── cmd/
│   ├── app/
│   │   └── main.go             📋 Entry point
│   └── crap-score/
│       └── main.go             📋 CRAP score computation (`go run ./cmd/crap-score`)
├── tools/
│   ├── tools.go                📋 Blank import for tool dependencies (go install pattern, `//go:build tools` tag)
│   ├── go-analyzers/           📋 Custom go vet analyzers (multichecker)
│   │   ├── cmd/anvil-lint/     📋 Single binary combining all analyzers
│   │   ├── anti_slop/          📋 Anti-slop analyzer packages
│   │   ├── structural/         📋 Structural analyzer packages
│   │   ├── test_quality/       📋 Test quality analyzer packages
│   │   ├── go.mod
│   │   └── Makefile            📋 Builds single anvil-lint binary
├── go.mod                      ⚙️ Go module config
├── .golangci.yml               ⚙️ golangci-lint config
├── Makefile                    ⚙️ Unified make targets
├── .pre-commit-config.yaml     ⚙️ Pre-commit + pre-push hooks
├── .gitignore                  ⚙️ Go gitignore
├── .editorconfig               📋 Editor config
├── .gitleaks.toml              📋 Secret scanning config
├── AGENTS.md                   ⚙️ Agent instructions
├── README.md                   ⚙️ Project readme
└── .anvil.lock                 ⚙️ Anvil manifest
```

#### Python Project

```
project-root/
├── src/
│   └── seed/                   📋 Seed code module (D-37)
│       ├── __init__.py         📋 Package init (defines __all__)
│       ├── seed.py             📋 Main module
│       ├── types.py            📋 Type definitions (TypedDict, Protocol)
│       ├── errors.py           📋 Custom exceptions
│       ├── constants.py        📋 Module constants
│       └── enums.py            📋 Module enums
├── tests/
│   ├── conftest.py             📋 Pytest fixtures (shared test setup)
│   └── test_seed.py            📋 Tests
├── tools/
│   └── flake8-plugin/          📋 Custom Flake8 plugin
│       ├── anvil_lint/
│       ├── setup.py
│       └── setup.cfg
├── pyproject.toml              ⚙️ Project config (Ruff, mypy, pytest, coverage, Python path)
│                                    # Includes [tool.pytest.ini_options] pythonpath = ["src"]
│                                    # so tests can `from seed import ...`
├── .flake8                     ⚙️ Flake8 config (enables ANV checkers from tools/flake8-plugin)
│                                    # select = ANV
│                                    # extend-exclude = .venv,tools/flake8-plugin
├── Makefile                    ⚙️ Unified make targets (uses `uv` for Python env, D-28)
├── .pre-commit-config.yaml     ⚙️ Pre-commit + pre-push hooks
├── .gitignore                  ⚙️ Python gitignore
├── .editorconfig               📋 Editor config
├── .gitleaks.toml              📋 Secret scanning config
├── AGENTS.md                   ⚙️ Agent instructions
├── README.md                   ⚙️ Project readme
└── .anvil.lock                 ⚙️ Anvil manifest
```

### Seed Code Design

Each seed module demonstrates:

1. **File organization** — types in `types.{ext}`, errors in `errors.{ext}`, constants in `constants.{ext}`
2. **Error handling** — proper error creation, wrapping, propagation (no log-and-continue, no error-obscuring)
3. **Structured logging** — using a structured logger, not print/console.log/fmt.Println
   - **TS/JS seed:** uses `pino` (lightweight, fast, structured JSON output)
   - **Go seed:** uses `log/slog` (stdlib, no external dependency)
   - **Python seed:** uses stdlib `logging` module with `logging.info("msg", extra={...})`
4. **Testing** — happy path, error path, edge case assertions (no empty tests, no tautological assertions)
5. **Function size** — each function under 50 lines
6. **File size** — each file under 100 lines (well under thresholds)
7. **Naming** — filename matches primary export

The seed module is named **`seed`** (D-37) — simple enough to understand in minutes, complex enough to demonstrate all patterns. It:
- Takes a name and language, returns a greeting
- Validates input (demonstrates error path)
- Has a custom error type (demonstrates errors.{ext})
- Uses constants for configuration values (demonstrates constants.{ext})
- Defines a Language enum (demonstrates enums.{ext})
- Defines a Result type (demonstrates types.{ext})
- Logs the operation (demonstrates structured logging)

The seed module contains **no comments, READMEs, or markers** signaling it is disposable. It must look identical to production code so agents treat it as the gold standard to mimic. The human receives the "this is seed code" signal exclusively from CLI output at scaffold time (see CLI Output section).

When the project has its own modules and the structure is established through real project code, the user can safely delete `src/seed/` / `internal/seed/` at any time.

### AGENTS.md Template

Under 40 lines. Covers what lint rules cannot enforce. **Generated per language** — paths and examples are language-specific:

    # Agent Instructions

    ## Validation

    - `make lint` — run often during development
    - `make check` — run before considering work done
    - `make quality` — run before marking work complete

    ## Code Conventions

    - Reference `<seed_path>` for file organization patterns
    - Prefer stdlib; consider well-established OSS libraries for complex problems
    - Every function that can fail must return an error / throw a typed exception
    - No dead code — if it's not called, delete it
    - Aim for high branch coverage (cover both sides of conditionals)

    ## Testing

    - Every source file needs a test file
    - Test the error paths, not just happy paths
    - Tests must contain real assertions (no empty tests, no tautological checks)
    - Use descriptive test names: "should [do X] when [condition Y]"
    - Mock at boundaries (HTTP, DB, filesystem), not internal functions

    ## What Lint Catches Automatically

    Don't worry about these — lint will catch them:
    - File organization (types, errors, constants, enums) [TS/Python; Go: convention via seed]
    - File/function length limits
    - Placeholder comments
    - Console.log / print / fmt.Println
    - Import ordering and formatting

Where `<seed_path>` is language-specific: `src/seed/` (TS/Python), `internal/seed/` (Go). Note: AGENTS.md references the seed path for file organization patterns but does **not** describe it as disposable or temporary — the agent must treat it as real code to mimic (D-37).

### .anvil.lock Format

```json
{
  "version": "1.0.0",
  "lang": "typescript",
  "context": {
    "projectName": "my-service",
    "packageManager": "bun",
    "defaultBranch": "main",
    "skipSeed": false
  },
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:30:00Z",
  "files": [
    {
      "path": "eslint.config.mjs",
      "checksum": "sha256:a1b2c3..."
    },
    {
      "path": "tools/lint-rules/plugin.js",
      "checksum": "sha256:d4e5f6..."
    }
  ]
}
```

## What Changes

### New Artifacts

All artifacts listed in the output file maps above. Total per language:
- TypeScript: ~23 files
- Go: ~20 files
- Python: ~18 files

### Workflow Changes

- New projects start with working code, lint rules, quality tools, and git hooks — all passing
- Agents see seed code as the gold standard for file organization and coding patterns
- AGENTS.md provides judgment-level guidance that lint can't enforce
- Pre-commit and pre-push hooks enforce quality locally before code reaches remote

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Seed code doesn't pass aggressive lint config | Low | High | Integration test: seed code must pass `make lint` with zero violations |
| AGENTS.md too verbose (>40 lines) | Low | Medium | Line count check in tests. Review on each update. |
| .anvil.lock format breaks between versions | Low | Medium | Lockfile has version field. Doctor can rebuild from disk state. Re-scaffold is idempotent — worst case, delete lockfile and re-run anvil init. |
| Seed code patterns don't translate across languages | Medium | Medium | Each language seed is authored independently, not mechanically translated. Test each independently. |

## Testing Strategy

### Seed Code Tests
- Each seed module's tests pass (`make test`)
- Each seed module passes all lint rules (`make lint`)
- Seed code is under file/function length thresholds
- Seed code demonstrates every convention (file organization, error handling, structured logging, testing patterns)

### AGENTS.md Tests
- Line count ≤ 40
- Contains required sections (Validation, Code Conventions, Testing)
- No duplicate content with lint rules

### Output Integrity Tests
- Every file in output map is generated
- .anvil.lock lists all generated files
- All checksums in .anvil.lock match file contents
- No anvil-generated files outside the output map (post-install artifacts like `bun.lock`, `go.sum` are expected side effects of `post.ts`, not tracked in the output map)
- Re-running anvil init on same project produces no changes (idempotent)
