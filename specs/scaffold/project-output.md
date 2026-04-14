# Project Output — Scaffold Artifacts

## Traceability

- **Shared Key**: `project-output`
- **Spec Path**: `specs/scaffold/project-output.md`
- **Requirement Refs**: `SCAF-01` through `SCAF-07`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-01, D-08, D-13, D-14, D-20, D-21, D-31, D-35)

## Problem Statement

When `anvil init` runs, it must produce a project that looks identical to one a senior developer configured manually. Every file must be in its conventional location, every config must be idiomatic for the language, and the seed code must demonstrate all conventions that custom lint rules enforce. The output must teach coding agents by example while being immediately useful to humans.

## Scope

### In Scope

- Seed code modules per language (SCAF-01)
- AGENTS.md template (SCAF-02)
- Makefile with unified targets (SCAF-03)
- Pre-commit configuration (SCAF-04)
- CI workflow templates for GitHub Actions and Azure Pipelines (SCAF-05)
- Project hygiene files: .gitignore, .editorconfig, .gitleaks.toml, README.md (SCAF-06)
- .anvil.lock manifest (SCAF-07)
- File placement conventions per language

### Out of Scope

- IDE-specific configuration (.vscode/, .idea/)
- Docker/containerization files
- Deployment configuration

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Scaffold model | Direct into standard locations | `[user]` D-01 |
| Seed code | Real working greeter module per language | `[user]` D-20 |
| AGENTS.md | Under 40 lines, complements lint | `[user]` D-21 |
| Existing project handling | Additive; skip seed if code exists | `[user]` D-08 |
| CI platforms | GitHub Actions + Azure Pipelines | `[user]` D-14 |

## Architecture

### Output File Map

What `anvil init --lang <lang> --ci <ci>` generates. Files marked with 📋 are static (copied as-is). Files marked with ⚙️ are generated dynamically (EJS templates or programmatic).

#### TypeScript Project

**Note (D-31):** The `typescript` language flag supports both TypeScript and JavaScript projects. Seed code is `.ts`-only. ESLint config handles `.js`/`.mjs` files natively. On existing `.js`-only projects, detection heuristics skip `tsconfig.json` and type-checked ESLint rules.

```
project-root/
├── src/
│   └── greeter/                📋 Seed code module
│       ├── greeter.ts          📋 Main module (function, error handling, structured logging)
│       ├── greeter.test.ts     📋 Tests (happy path + error path + edge cases)
│       ├── types.ts            📋 Exported types for the module
│       ├── errors.ts           📋 Custom error classes
│       ├── constants.ts        📋 Module constants
│       └── enums.ts            📋 Module enums (e.g., GreetingLanguage)
├── tools/
│   ├── lint-rules/             📋 ESLint plugin source
│   │   ├── plugin.js
│   │   ├── anti-slop/
│   │   ├── structural/
│   │   └── test-quality/
│   └── crap-score.ts           📋 CRAP score computation script
├── eslint.config.mjs           ⚙️ ESLint flat config (imports local plugin)
├── tsconfig.json               ⚙️ Strict TypeScript config
├── package.json                ⚙️ Dependencies + scripts
├── vitest.config.ts            ⚙️ Vitest config with coverage
├── knip.json                   📋 Dead code detection config
├── stryker.config.mjs          📋 Mutation testing config
├── Makefile                    ⚙️ Unified make targets
├── .pre-commit-config.yaml     ⚙️ Pre-commit hooks
├── .github/workflows/ci.yml   ⚙️ GitHub Actions CI (if --ci github|both)
├── azure-pipelines.yml         ⚙️ Azure Pipelines CI (if --ci azure|both)
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
│   └── greeter/                📋 Seed code module
│       ├── greeter.go          📋 Main module
│       ├── greeter_test.go     📋 Tests
│       ├── types.go            📋 Exported types
│       ├── errors.go           📋 Custom error types
│       ├── constants.go        📋 Module constants
│       └── enums.go            📋 Module enums (e.g., Language iota)
├── cmd/
│   └── app/
│       └── main.go             📋 Entry point
├── tools/
│   ├── go-analyzers/           📋 Custom go vet analyzers (multichecker)
│   │   ├── cmd/anvil-lint/     📋 Single binary combining all 16 analyzers
│   │   ├── anti_slop/          📋 Anti-slop analyzer packages
│   │   ├── structural/         📋 Structural analyzer packages
│   │   ├── test_quality/       📋 Test quality analyzer packages
│   │   ├── go.mod
│   │   └── Makefile            📋 Builds single anvil-lint binary
│   └── crap-score.go           📋 CRAP score computation script
├── go.mod                      ⚙️ Go module config
├── .golangci.yml               ⚙️ golangci-lint config
├── Makefile                    ⚙️ Unified make targets
├── .pre-commit-config.yaml     ⚙️ Pre-commit hooks
├── .github/workflows/ci.yml   ⚙️ GitHub Actions CI (if --ci github|both)
├── azure-pipelines.yml         ⚙️ Azure Pipelines CI (if --ci azure|both)
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
│   └── greeter/                📋 Seed code module
│       ├── __init__.py         📋 Package init (defines __all__)
│       ├── greeter.py          📋 Main module
│       ├── types.py            📋 Type definitions (TypedDict, Protocol)
│       ├── errors.py           📋 Custom exceptions
│       ├── constants.py        📋 Module constants
│       └── enums.py            📋 Module enums (e.g., GreetingLanguage Enum)
├── tests/
│   └── test_greeter.py         📋 Tests
├── tools/
│   └── flake8-plugin/          📋 Custom Flake8 plugin
│       ├── anvil_lint/
│       ├── setup.py
│       └── setup.cfg
├── pyproject.toml              ⚙️ Project config (Ruff, mypy, pytest, coverage, Python path)
│                                    # Includes [tool.pytest.ini_options] pythonpath = ["src"]
│                                    # so tests can `from greeter import ...`
├── Makefile                    ⚙️ Unified make targets (uses `uv` for Python env, D-28)
├── .pre-commit-config.yaml     ⚙️ Pre-commit hooks
├── .github/workflows/ci.yml   ⚙️ GitHub Actions CI (if --ci github|both)
├── azure-pipelines.yml         ⚙️ Azure Pipelines CI (if --ci azure|both)
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
4. **Testing** — happy path, error path, edge case assertions (no empty tests, no tautological assertions)
5. **Function size** — each function under 50 lines
6. **File size** — each file under 100 lines (well under thresholds)
7. **Naming** — filename matches primary export

The seed module is a **greeter** — simple enough to understand in minutes, complex enough to demonstrate all patterns. It:
- Takes a name and language, returns a greeting
- Validates input (demonstrates error path)
- Has a custom error type (demonstrates errors.{ext})
- Uses constants for configuration values (demonstrates constants.{ext})
- Defines a GreetingLanguage enum (demonstrates enums.{ext})
- Defines a GreetingResult type (demonstrates types.{ext})
- Logs the greeting operation (demonstrates structured logging)

### AGENTS.md Template

Under 40 lines. Covers what lint rules cannot enforce. **Generated per language** — paths and examples are language-specific:

```markdown
# Agent Instructions

## Validation

Run before every commit:
```
make check
```

## Code Conventions

- Reference `<seed_path>` for file organization patterns
- Prefer stdlib; consider well-established OSS libraries for complex problems
- Every function that can fail must return an error / throw a typed exception
- No dead code — if it's not called, delete it
- Aim for high branch coverage (cover both sides of conditionals)

## Testing

- Every source file needs a test file
- Test the error paths, not just happy paths
- Tests must contain real assertions (no empty tests, no `expect(true).toBe(true)`)
- Use descriptive test names: "should [do X] when [condition Y]"
- Mock at boundaries (HTTP, DB, filesystem), not internal functions

## What Lint Catches Automatically

Don't worry about these — lint will catch them:
- File organization (types, errors, constants, enums)
- File/function length limits
- Placeholder comments
- Console.log / print / fmt.Println
- Import ordering
- Formatting
```

Where `<seed_path>` is language-specific: `src/greeter/` (TS/Python), `internal/greeter/` (Go).

### .anvil.lock Format

```json
{
  "version": "1.0.0",
  "lang": "typescript",
  "ci": "github",
  "context": {
    "projectName": "my-service",
    "packageManager": "bun",
    "defaultBranch": "main"
  },
  "createdAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:30:00Z",
  "files": [
    {
      "path": "eslint.config.mjs",
      "checksum": "sha256:a1b2c3...",
      "source": "template"
    },
    {
      "path": "tools/lint-rules/plugin.js",
      "checksum": "sha256:d4e5f6...",
      "source": "static"
    }
  ]
}
```

### CI Workflow Structure

#### GitHub Actions

```yaml
name: CI
on:
  push:
    branches: [<defaultBranch>]   # From ScaffoldContext.defaultBranch
  pull_request:
    branches: [<defaultBranch>]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: {language-setup-action}
      - run: {install-deps}              # npm ci / go mod download / uv sync
      - run: {install-global-tools}      # gitleaks, pre-commit (D-35)
      - run: make check                  # Tier 1 + Tier 2
```

#### Azure Pipelines

```yaml
trigger:
  branches:
    include: [<defaultBranch>]   # From ScaffoldContext.defaultBranch
pr:
  branches:
    include: [<defaultBranch>]

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: {language-setup-task}
  - script: {install-deps}
  - script: {install-global-tools}      # gitleaks, pre-commit (D-35)
  - script: make check
    displayName: 'Quality checks'
```

## What Changes

### New Artifacts

All artifacts listed in the output file maps above. Total per language:
- TypeScript: ~25 files
- Go: ~22 files
- Python: ~20 files

### Workflow Changes

- New projects start with working code, lint rules, quality tools, and CI — all passing
- Agents see seed code as reference for conventions
- AGENTS.md provides judgment-level guidance that lint can't enforce

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Seed code doesn't pass aggressive lint config | Low | High | Integration test: seed code must pass `make lint` with zero violations |
| AGENTS.md too verbose (>40 lines) | Low | Medium | Line count check in CI. Review on each update. |
| CI workflow syntax error | Low | High | Validate YAML syntax in tests. Test workflows in CI. |
| .anvil.lock format breaks between versions | Low | High | Lockfile has version field. Migration logic reads version first. |
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

### CI Workflow Tests
- YAML is valid
- Required steps present (checkout, setup, install, make check)
- Language-specific setup action correct

### Output Integrity Tests
- Every file in output map is generated
- .anvil.lock lists all generated files
- All checksums in .anvil.lock match file contents
- No files generated outside the output map (no side effects)
