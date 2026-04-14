# Scaffold Engine & CLI Commands

## Traceability

- **Shared Key**: `scaffold-engine`
- **Spec Path**: `specs/cli/scaffold-engine.md`
- **Requirement Refs**: `CLI-01`, `CLI-02`, `CLI-03`, `CLI-04`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-01, D-02, D-03, D-04, D-08, D-09, D-11, D-22, D-23, D-29, D-31, D-32, D-33, D-35)

## Problem Statement

Coding agents produce structurally bloated, convention-ignoring code when working in unscaffolded repositories. Developers need a one-command way to initialize any Go, TypeScript/JS, or Python project with anti-slop lint rules, quality tooling, CI workflows, and agent instructions — all wired into the agent's feedback loop. The scaffolded output must look identical to a manually-configured project. Updates must be non-destructive and smart.

## Scope

### In Scope

- `anvil init --lang <golang|typescript|python> [--ci <github|azure|both|none>]` command
- `anvil update [--dry-run] [--force]` command
- `anvil doctor` command
- Scaffold engine: static file copying + EJS template rendering
- `.anvil.lock` manifest: file tracking, checksums, version provenance
- Conflict resolution for existing files during init
- Existing project detection (language-aware heuristics)
- Standalone binary compilation via `bun build --compile`
- Distribution: npx, bunx, standalone binary

### Out of Scope

- `anvil eject` (deferred to v2 — D-02)
- `anvil migrate` for adding languages to existing anvil projects (deferred — D-04)
- Config presets (strict/moderate/minimal) — v1 ships opinionated defaults only
- IDE integration plugins

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Scaffold model | Direct scaffold into standard project locations; no `.anvil/` managed directory | `[user]` D-01 |
| Lockfile | `.anvil.lock` JSON at project root tracks version, files, checksums | `[user]` D-01 |
| CLI framework | Commander.js | `[decision]` D-23 |
| Interactive prompts | @inquirer/prompts | `[decision]` D-23 |
| Template rendering | EJS for dynamic configs | `[decision]` D-23 |
| Terminal output | Chalk for colored output | `[decision]` D-23 |
| File I/O | Bun built-ins (Bun.write, Bun.file) | `[decision]` D-23 |
| Scaffold engine | Hybrid: static files copied as-is + programmatic configs via EJS | `[decision]` D-22 |
| Existing project detection | Language-aware heuristics (Go: .go/go.mod, TS: .ts/.js/package.json, Python: .py/__init__.py) | `[user]` D-08 |
| Go analyzer compilation | Build on first `make lint`, not on init | `[decision]` D-03 |
| Doctor behavior | Report + auto-fix non-destructive issues | `[decision]` D-04 |
| Update strategy | Semver-aware; refuse major version jumps without --force | `[decision]` D-09 |
| Distribution | npx + bunx + standalone compiled binary | `[user]` D-11 |

## Architecture

### Component Overview

```
src/
├── cli.ts                    # Commander program definition
├── commands/
│   ├── init.ts               # Init command handler
│   ├── update.ts             # Update command handler
│   └── doctor.ts             # Doctor command handler
├── scaffold/
│   ├── engine.ts             # Core: orchestrates static copy + template render + lockfile write
│   ├── conflict.ts           # File conflict resolution (check exists → prompt user)
│   ├── lockfile.ts           # .anvil.lock read/write/diff/checksum
│   └── detect.ts             # Existing project detection heuristics
├── generators/
│   ├── typescript.ts         # TS/JS dynamic config generators
│   ├── golang.ts             # Go dynamic config generators
│   └── python.ts             # Python dynamic config generators
└── templates/                # EJS templates for dynamic configs
    ├── Makefile.ejs
    ├── github-ci.yml.ejs
    ├── azure-pipelines.yml.ejs
    ├── eslint.config.mjs.ejs
    ├── golangci.yml.ejs
    ├── pyproject.toml.ejs
    ├── pre-commit-config.yml.ejs
    └── ...
```

### Data / Control Flow

#### `anvil init`

```
User runs: anvil init --lang typescript [--ci github]
                ▼
         Commander parses args
         (--ci defaults to "none" if omitted)
                │
                ▼
    ┌─── detect.ts ───────────────┐
    │  Check for existing code:    │
    │  - .ts/.js files?           │
    │  - package.json with deps?  │
    │  - src/ or lib/ or app/?    │
    │                              │
    │  Result: { hasCode: bool,    │
    │            sourceDir: string }│
    │                              │
    │  TS/JS: detect pkg manager   │
    │  from lockfile (D-29):       │
    │  bun.lock → bun             │
    │  package-lock.json → npm    │
    │  pnpm-lock.yaml → pnpm     │
    │  yarn.lock → yarn           │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── @inquirer/prompts ───────┐
    │  - Project name             │
    │  - Confirm options          │
    │  - (if hasCode) Skip seed?  │
    │  - (TS, no lockfile found)  │
    │    Package manager?         │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── engine.ts ───────────────┐
    │  For each file in manifest: │
    │                              │
    │  Static file?               │
    │    → conflict.ts check      │
    │    → copy from static/      │
    │                              │
    │  Dynamic config?            │
    │    → generators/{lang}.ts   │
    │    → render EJS template    │
    │    → conflict.ts check      │
    │    → write to disk          │
    │                              │
    │  Record in .anvil.lock      │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── Post-scaffold ──────────┐
    │  Run package manager install│
    │  (npm/bun/go mod/pip)       │
    │  Print summary              │
    └─────────────────────────────┘
```

#### `anvil update`

```
User runs: anvil update
        │
        ▼
  Read .anvil.lock → { version, context, files: [{ path, checksum }] }
        │
        ▼
  Compare installed version vs current anvil version
        │
        ├── Major version jump without --force → error + exit
        │
        ▼
  For each tracked file:
        │
        ├── Re-render original template using lockfile.context (base)
        ├── Render new template using current anvil version (theirs)
        ├── Read current disk content (ours)
        │
        ├── base === ours (user didn't modify)
        │   → Apply new version silently
        │
        ├── base !== ours AND base !== theirs (both modified)
        │   → Show 3-way diff → prompt accept/skip/manual-merge
        │
        ├── base !== ours AND base === theirs (only user modified, no upstream change)
        │   → Keep user version, update checksum in lockfile
        │
        ├── File missing on disk
        │   → User deleted → prompt recreate/skip
        │
        └── New file in new version (not in lockfile)
            ├── Path exists on disk → treat as conflict, prompt (D-33)
            └── Path does not exist → create without prompting
        │
        ▼
  Update .anvil.lock with new checksums + version + context
```

#### `anvil doctor`

```
User runs: anvil doctor
        │
        ▼
  ┌── Tool checks ──────────────────┐
  │  Per language:                   │
  │  TS: node, npm/bun, eslint      │
  │  Go: go, golangci-lint          │
  │  Python: python, uv, ruff, flake8│
  │  All: pre-commit, gitleaks      │
  └──────────┬───────────────────────┘
             │
             ▼
  ┌── Config checks ────────────────┐
  │  eslint.config.mjs exists?      │
  │  .golangci.yml exists?          │
  │  pyproject.toml has [tool.ruff]?│
  │  Makefile has required targets? │
  │  .pre-commit-config.yaml valid? │
  └──────────┬───────────────────────┘
             │
             ▼
  ┌── Lockfile checks ──────────────┐
  │  .anvil.lock exists?            │
  │  Checksums match disk?          │
  │  Version compatible?            │
  └──────────┬───────────────────────┘
             │
             ▼
  ┌── Auto-fix (non-destructive) ──┐
  │  Missing .gitignore entries     │
  │  Missing config keys            │
  │  Malformed JSON/YAML (fixable)  │
  └──────────┬───────────────────────┘
             │
             ▼
  ┌── Report ────────────────────────┐
  │  ✅ 12 checks passed            │
  │  🔧 2 issues auto-fixed        │
  │  ❌ 1 issue needs manual fix:  │
  │     golangci-lint not installed │
  │     → Run: go install ...       │
  └──────────────────────────────────┘
```

### Integration Points

- **Package managers:** `npm install` / `bun install` / `go mod tidy` / `uv pip install -e ".[dev]"` — run post-scaffold
- **Git:** Check if `.git` exists; suggest `git init` if not
- **pre-commit:** Run `pre-commit install` post-scaffold to set up hooks
- **Bun compiler:** `bun build --compile` for standalone binary distribution

### Tool Provisioning (D-35)

All language-specific tools are declared as project dependencies and installed via standard package managers. Only `gitleaks` and `pre-commit` are global tools.

**TS/JS:** Quality tools added to `package.json` `devDependencies`:
- `eslint`, `prettier`, `vitest`, `@vitest/coverage-v8`, `knip`, `@stryker-mutator/core`, `eslint-plugin-security`, `eslint-plugin-barrel-files`, `typescript`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`

**Go:** Tools vendored via `tools/tools.go` blank import pattern + Makefile `go install` targets:
- `golangci-lint`, `deadcode`, `govulncheck`, `go-mutesting` (installed via `go install`)
- Custom analyzers built from source in `tools/go-analyzers/`

**Python:** Dev dependencies in `pyproject.toml` `[project.optional-dependencies.dev]`:
- `ruff`, `flake8`, `mypy`, `pytest`, `pytest-cov`, `vulture`, `mutmut`
- Custom Flake8 plugin installed via `uv pip install -e tools/flake8-plugin/`

**Global tools (all languages):** `gitleaks`, `pre-commit` — documented in README with install instructions, checked by `anvil doctor`.

**CI bootstrap:** CI workflow templates include explicit tool install steps before `make check`.

### Key Interfaces

#### ScaffoldContext (passed to engine)

```typescript
interface ScaffoldContext {
  projectName: string;
  lang: "typescript" | "golang" | "python";
  ci: "github" | "azure" | "both" | "none";
  targetDir: string;
  hasExistingCode: boolean;
  sourceDir?: string;        // detected source directory (src/, lib/, etc.)
  packageManager?: string;   // TS/JS only: npm, bun, pnpm, yarn (detected or prompted)
  defaultBranch?: string;    // for CI config (default: main)
  anvilVersion: string;
}
```

#### LockfileEntry

```typescript
interface LockfileEntry {
  path: string;              // relative path from project root
  checksum: string;          // SHA-256 of file contents
  source: "static" | "template" | "generated";
}

interface AnvilLockfile {
  version: string;           // anvil version that generated these files
  lang: string;
  ci: string;
  context: {                 // full generation context for deterministic re-render (D-24/C1)
    projectName: string;
    packageManager?: string; // TS/JS only
    defaultBranch: string;
    sourceDir?: string;
  };
  files: LockfileEntry[];
  createdAt: string;         // ISO timestamp
  updatedAt: string;
}
```

#### ConflictResolution

```typescript
type ConflictAction = "overwrite" | "skip" | "diff" | "abort";

interface ConflictResult {
  path: string;
  action: ConflictAction;
}
```

#### DoctorCheck

```typescript
interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "fixed";
  message: string;
  fix?: string;              // auto-fix description (if applied)
  instruction?: string;      // manual fix instruction (if not auto-fixable)
}
```

## What Changes

### New Artifacts

| Artifact | Description |
|----------|-------------|
| `src/cli.ts` | CLI entry point with Commander setup |
| `src/commands/init.ts` | Init command handler |
| `src/commands/update.ts` | Update command handler |
| `src/commands/doctor.ts` | Doctor command handler |
| `src/scaffold/engine.ts` | Core scaffold engine |
| `src/scaffold/conflict.ts` | File conflict resolution |
| `src/scaffold/lockfile.ts` | .anvil.lock management |
| `src/scaffold/detect.ts` | Existing project detection |
| `src/generators/*.ts` | Per-language config generators |
| `src/templates/*.ejs` | EJS templates for dynamic configs |
| `static/*/` | Static files per language |
| `package.json` | Bun project config with dependencies |

### Workflow Changes

- Users run `anvil init` instead of manually configuring lint, CI, quality tools
- Users run `anvil update` to get new lint rules without reconfiguring
- Users run `anvil doctor` to diagnose configuration issues

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Package manager install fails | Medium | Medium | Graceful error: scaffold succeeds, print manual install command |
| Existing project detection false positive (skips seed when it shouldn't) | Low | Low | Seed skip is prompted, user can override |
| .anvil.lock corruption | Low | Medium | Doctor can rebuild lockfile from disk state |
| Major version update breaks user config | Low | High | Semver guard: refuse without --force. Clear migration notes in changelog. |
| EJS template syntax error in dynamic config | Low | High | All templates tested in CI with snapshot tests |
| Bun standalone binary too large | Medium | Low | Strip unused modules. Binary size acceptable for dev tooling. |

## Testing Strategy

### Unit Tests
- `detect.ts`: test each language heuristic with fixture directories
- `lockfile.ts`: test read/write/diff/checksum operations
- `conflict.ts`: test each conflict action
- `engine.ts`: test with mock filesystem (Bun.write spy)
- `generators/*.ts`: test each config generator outputs valid configs

### Integration Tests
- `anvil init --lang typescript` in temp dir → verify all files exist, lockfile correct
- `anvil init` on existing project → verify seed code skipped, tooling added
- `anvil update` after modifying a file → verify diff shown, unmodified files updated
- `anvil doctor` with missing tool → verify correct diagnosis

### Snapshot Tests
- Each EJS template rendered with default context → snapshot of output
- Prevents accidental template regressions

### E2E Tests
- Full `init → lint → test → update` cycle per language
- Verify generated project passes its own lint rules
