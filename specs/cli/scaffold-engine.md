# Scaffold Engine & CLI Commands

## Traceability

- **Shared Key**: `scaffold-engine`
- **Spec Path**: `specs/cli/scaffold-engine.md`
- **Requirement Refs**: `CLI-01`, `CLI-03`, `CLI-04`, `CLI-05`, `CLI-06`, `CLI-07`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-01, D-03, D-04, D-08, D-22, D-23, D-29, D-31, D-35, D-39, D-40, D-41, D-42, D-43, D-45, D-58, D-59, D-60, D-61, D-67; superseded: D-02, D-11, D-32, D-33, D-56)

## Problem Statement

Coding agents produce structurally bloated, convention-ignoring code when working in unscaffolded repositories. Developers need a one-command way to initialize any Go, TypeScript/JS, or Python project with anti-slop lint rules, quality tooling, git hooks, and agent instructions — all wired into the agent's feedback loop. The scaffolded output must look identical to a manually-configured project. Re-running `anvil init` must be safe and idempotent — only changed files are prompted for update, unchanged files are skipped automatically.

## Scope

### In Scope

- `anvil init --lang <golang|typescript|python> [--dry-run] [--non-interactive]` command
- `anvil doctor` command
- FsTree virtual file system for staged file operations
- Idempotent re-scaffold (re-running `anvil init` safely updates files)
- `--dry-run` flag on `anvil init` (preview changes without writing)
- `--non-interactive` flag on `anvil init` (explicit opt-in only — D-67 supersedes D-56). Setup prompts resolve from detected/lockfile/defaults. Conflicts → structured diff report on stderr + exit non-zero, no files written.
- Scaffold engine: static file copying + EJS template rendering
- `.anvil.lock` manifest: file tracking, checksums, generation context
- Conflict resolution for existing files during init
- Existing project detection (language-aware heuristics)
- Distribution: bun-only + compiled standalone binary (D-45)

### Out of Scope

- `anvil update` (deferred to v2 — D-39)
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
| File system abstraction | FsTree: in-memory staging with sequential flush (from Nx) | `[research]` D-40 |
| Re-scaffold model | Idempotent re-run of `anvil init`; FsTree classifies CREATE/UPDATE; per-file prompts for updates | `[research]` D-39, D-41 |
| Distribution | Bun-only + compiled standalone binary | `[user]` D-45 |

## Architecture

### Component Overview

```
src/
├── cli.ts                    # Commander program definition
├── commands/
│   ├── init.ts               # Init command handler
│   └── doctor.ts             # Doctor command handler
├── engine/
│   ├── tree.ts               # FsTree: in-memory virtual file system (from Nx)
│   ├── render.ts             # Template rendering (EJS + static copy)
│   ├── conflict.ts           # Per-file conflict prompts (overwrite/skip/abort; diff as preview)
│   ├── lockfile.ts           # .anvil.lock read/write/checksum
│   ├── detect.ts             # Existing project detection heuristics
│   └── post.ts               # Post-scaffold tasks (package install, git hooks)
├── manifests/
│   ├── index.ts              # Aggregator: loads correct manifest by --lang flag
│   ├── typescript.ts         # TS/JS file manifest (which files to scaffold)
│   ├── golang.ts             # Go file manifest
│   └── python.ts             # Python file manifest (supports seed filtering)
├── generators/
│   ├── typescript.ts         # TS/JS dynamic config generators
│   ├── golang.ts             # Go dynamic config generators
│   └── python.ts             # Python dynamic config generators
└── templates/                # EJS templates for dynamic configs
    ├── Makefile.ejs
    ├── eslint.config.mjs.ejs
    ├── golangci.yml.ejs
    ├── pyproject.toml.ejs
    ├── pre-commit-config.yml.ejs
    └── ...
```

### FsTree Virtual File System (D-40)

All file operations go through an in-memory tree. Changes are staged, classified (CREATE/UPDATE/DELETE), and flushed to disk. This gives us dry-run, preview, and re-scaffold for free.

**Design adapted from Nx's `packages/nx/src/generators/tree.ts` (~466 LOC).** Our interface simplifies Nx's — we omit `isFile()`, `children()`, and `changePermissions()` which aren't needed for scaffolding.

**Concurrency guard:** Anvil acquires an exclusive directory lockfile (`.anvil.lock.pid`) before reading disk state. If a second `anvil init` targets the same directory, it exits with an error ("scaffold already in progress"). The lockfile is released after flush + lockfile write completes (or on abort/error). This prevents TOCTOU races between classify and flush.

**Lockfile format:** JSON `{ "pid": <number>, "startTime": <ISO timestamp>, "command": "anvil init --lang ..." }`. Created atomically via `writeFileSync` with `O_EXCL` flag. **Stale detection:** if PID is not running OR process start time doesn't match, the lockfile is stale and removed. This prevents false-positive locks from PID reuse. **Lock acquisition failure** (read-only directory, permissions): immediate exit code 1 with error message, no partial work.

```typescript
interface FsTree {
  read(path: string): Buffer | null;
  write(path: string, content: string | Buffer): void;
  exists(path: string): boolean;
  delete(path: string): void;     // v1: unused by init flow; kept for v2 re-scaffold (file removal)
  rename(oldPath: string, newPath: string): void;  // v1: unused; kept for v2 migration support
  listChanges(): FileChange[];
}

interface FileChange {
  path: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  content: string | Buffer;
}

// Standalone function — accepts filtered changes (not all recorded changes).
// After conflict resolution, pass only approved FileChanges.
function flushChanges(changes: FileChange[], targetDir: string): void;
```

Key behaviors (verified against Nx source):
- All writes go to an in-memory `recordedChanges` dictionary (`{ [path]: { content, isDeleted } }`), never directly to disk
- **Smart dedup** (Nx lines 184-191): if written content === disk content, the change is removed from `recordedChanges` (no-op)
- **`listChanges()`** (Nx lines 297-323): classifies changes as CREATE (not on disk), UPDATE (on disk, different content), or DELETE
- **v1 conflict model:** FsTree uses 2-way comparison (new template output vs current disk). This cannot distinguish "user edited this file" from "anvil generated a different version" (D-32 noted this limitation). The tradeoff is acceptable: per-file prompts on UPDATE let the user decide, and `skip` is always safe. 3-way merge (using lockfile checksums as base) is deferred to v2.
- **`flushChanges()`** (Nx lines 436-450): standalone function that writes changes to disk sequentially. Unlike Nx (which flushes all recorded changes), anvil's `flushChanges()` accepts a filtered `FileChange[]` — only changes approved during conflict resolution are flushed. Skipped files are simply omitted from the list. **Not transactional** — Nx writes files one by one. For anvil, this is acceptable because scaffold operations are idempotent (re-run fixes partial writes).
- ~200 lines of TypeScript for our simplified version

**FsTree and .anvil.lock:** FsTree does NOT manage `.anvil.lock`. The lockfile is read separately by `lockfile.ts` for re-scaffold context (pre-filling prompts with previous values), and written separately after flush as a metadata step. FsTree's `listChanges()` and `flushChanges()` never include `.anvil.lock` in their scope.

**Lockfile checksums during re-scaffold:** Existing checksums in `.anvil.lock` are used for **integrity checking** (`anvil doctor` verifies file checksums match) and **provenance** (tracking what anvil generated), NOT for conflict detection. FsTree's 2-way comparison (new template vs disk) handles change classification. The lockfile's primary re-scaffold role is providing stored context (project name, package manager, etc.) to pre-fill prompts.

**`--non-interactive` exit code (D-67 supersedes D-56):** When `--non-interactive` mode (explicit flag only) encounters one or more `UPDATE` conflicts, the CLI prints a structured unified-diff report to stderr and exits **non-zero with no files written** (all-or-nothing transaction — including any `CREATE` files). When there are no conflicts, the CLI writes all classified changes and exits 0. If everything is no-op (nothing to do), exit 0 with a "no changes" message.

**Error handling:**
- **Template render failure:** Aborts before `flushChanges()`. No files written, no lockfile, no post-steps. Exits non-zero with error message identifying the failing template path.
- **Partial flush failure** (e.g., permission denied): Stops immediately. Does NOT write `.anvil.lock` or run `post.ts`. Exits non-zero. Recovery: fix the permission issue and re-run `anvil init` (idempotent).
- **Post-install failure** (e.g., npm install fails): Scaffold files and lockfile are already written (success). Prints manual install command. Exits 0 (scaffold succeeded; install is best-effort).

### Data / Control Flow

#### `anvil init`

```
User runs: anvil init --lang typescript
                ▼
         Commander parses args
                │
                ▼
    ┌─── acquirePidLock ──────────┐
    │  Create .anvil.lock.pid     │
    │  atomically (O_EXCL).       │
    │  On existing lock:           │
    │  - Check PID + startTime;   │
    │    if dead/mismatch/invalid │
    │    JSON → remove as stale   │
    │    and retry once.          │
    │  - Otherwise: exit 1        │
    │    "scaffold already in     │
    │     progress (pid=N)"       │
    │  On permission error:       │
    │    exit 1 immediately       │
    │  Release in finally block   │
    │  (success, abort, crash).   │
    └──────────┬──────────────────┘
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
    │  If multiple lockfiles exist │
    │  → interactive: prompt user  │
    │  → non-interactive: error    │
    │    "Ambiguous package manager│
    │    (found bun.lock +         │
    │    package-lock.json)"       │
    │                              │
    │  Single lockfile precedence: │
    │  bun.lock → bun             │
    │  package-lock.json → npm    │
    │  pnpm-lock.yaml → pnpm     │
    │  yarn.lock → yarn           │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── Check .anvil.lock ───────┐
    │  Exists? → Re-scaffold mode │
    │  Load stored context        │
    │  (allows defaults from      │
    │   previous run)             │
    │                              │
    │  Language mismatch?         │
    │  (lock.lang != --lang)      │
    │  → Exit non-zero (D-60):    │
    │  "This project was          │
    │   scaffolded for {lock.lang}.│
    │   Cross-language migration  │
    │   is not supported in v1.   │
    │   Use a separate directory  │
    │   or delete .anvil.lock to  │
    │   start fresh."             │
    │                              │
    │  Not exists? → Fresh init   │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── @inquirer/prompts ───────┐
    │  - Project name             │
    │  - Default branch (main)    │
    │  - (if hasCode) Skip seed?  │
    │  - (TS, no lockfile found)  │
    │    Package manager?         │
    │                              │
    │  (Re-scaffold: pre-fill     │
    │   from previous context)    │
    │                              │
    │  (--non-interactive only,    │
    │   D-67; pipe without flag    │
    │   = error, not auto-mode):   │
    │   skip all prompts.          │
    │   Precedence:               │
    │   detected state > defaults │
    │   projectName = dir name,   │
    │   packageManager = detected │
    │     from lockfile, else bun,│
    │   defaultBranch = "main",   │
    │   seed = skip if hasCode)   │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── FsTree + render.ts ──────┐
    │  Create FsTree(targetDir)    │
    │                              │
    │  Build manifest from lang:   │
    │  (if skipSeed, exclude seed  │
    │   files from manifest)       │
    │                              │
    │  For each file in manifest:  │
    │                              │
    │  Static file?                │
    │    → tree.write(path, content)│
    │                              │
    │  Dynamic config?             │
    │    → generators/{lang}.ts    │
    │    → render EJS template     │
    │    → tree.write(path, result)│
    │                              │
    │  (FsTree auto-deduplicates:  │
    │   if content === disk, no-op)│
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── tree.listChanges() ──────┐
    │  Classify all changes:       │
    │                              │
    │  CREATE → new file, auto-add │
    │  UPDATE → file differs       │
    │    → conflict.ts prompts:    │
    │      overwrite / skip / diff │
    │      / abort (exits before   │
    │        flush; no files       │
    │        written, no lockfile, │
    │        exit code 1)          │
    │  (No DELETE in init flow —   │
    │   anvil never deletes files  │
    │   from disk. Lockfile entries │
    │   for files no longer in the │
    │   template are pruned from   │
    │   .anvil.lock metadata only) │
    │                              │
    │  --dry-run: print classified │
    │  changes, skip conflict      │
    │  prompts, stop here.         │
    │                              │
    │  --non-interactive: UPDATE   │
    │  conflicts → diff report on  │
    │  stderr + exit non-zero,     │
    │  NO files written (D-67)     │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─ flushChanges(approved, dir) ┐
    │  Write approved changes to   │
    │  disk sequentially           │
    │  (idempotent — re-run safe)  │
    │                              │
    │  Skipped in --dry-run mode.  │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── lockfile.ts ─────────────┐
    │  Write .anvil.lock with:     │
    │  - anvil version             │
    │  - language                   │
    │  - full context (all prompts)│
    │  - file checksums            │
    │                              │
    │  Note: .anvil.lock is NOT    │
    │  included in its own files[] │
    │  (self-checksum impossible). │
    │  Written outside FsTree as   │
    │  a post-flush metadata step. │
    │                              │
    │  Skipped in --dry-run mode.  │
    └──────────┬──────────────────┘
               │
               ▼
    ┌─── post.ts ─────────────────┐
    │  Run package manager install │
    │  TS/JS: npm/bun/pnpm/yarn   │
    │    install                   │
    │  Go: go mod tidy             │
    │  Python: uv pip install      │
    │    -e ".[dev]" && uv pip     │
    │    install -e tools/         │
    │    flake8-plugin/ (D-35)     │
    │                              │
    │  Git setup:                  │
    │  - If no .git: run git init  │
    │  - If no git binary: warn    │
    │    and skip hook install     │
    │  - If pre-commit not found:  │
    │    warn "pre-commit not      │
    │    installed — hooks skipped. │
    │    Install: pip install       │
    │    pre-commit" and continue  │
    │  - Run pre-commit install    │
    │    (installs both pre-commit │
    │     and pre-push hooks via   │
    │     default_install_hook_types)│
    │  Print summary               │
    │                              │
    │  Skipped in --dry-run mode.  │
    │  If install fails: scaffold  │
    │  still succeeds; print       │
    │  manual install command.     │
    └─────────────────────────────┘
```

#### `anvil doctor`

```
User runs: anvil doctor
        │
        ▼
  ┌── Tool checks ──────────────────┐
  │  Global prerequisites:          │
  │  All: git, pre-commit, gitleaks │
  │                                 │
  │  Language runtimes:             │
  │  TS: node + detected PM        │
  │    (npm/bun/pnpm/yarn)         │
  │  Go: go                         │
  │  Python: python, uv             │
  │                                 │
  │  Project deps (verify installed │
  │  via package manager):          │
  │  TS: eslint, prettier, vitest,  │
  │      knip, typescript           │
  │  Go: golangci-lint, deadcode,   │
  │      govulncheck, anvil-lint    │
  │  Python: ruff, flake8, mypy,    │
  │      pytest, pip-audit          │
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
  │  → Missing: warn, suggest      │
  │    re-run anvil init           │
  │  → Malformed/unparseable: warn │
  │    "Delete .anvil.lock and     │
  │     re-run `anvil init` to     │
  │     rebuild." Doctor does NOT  │
  │    auto-rebuild the lockfile   │
  │    (would be destructive if    │
  │     files were user-modified). │
  │  Checksums match disk?          │
  │  → Mismatch: report as "drift" │
  │    (user-modified file), NOT   │
  │    corruption. Warn, don't fail│
  │  Version compatible?            │
  │  → Same major version = OK     │
  │  → Different major = warn      │
  │    "generated by anvil X,      │
  │     running anvil Y"           │
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

- **Package managers:** `npm install` / `bun install` / `pnpm install` / `yarn` / `go mod tidy` / `uv pip install -e ".[dev]"` — run post-scaffold
- **Git:** Auto-run `git init` if `.git` does not exist. If `git` is not installed, warn and skip hook installation (scaffold still succeeds).
- **pre-commit:** Run `pre-commit install` post-scaffold to set up hooks (requires git repo)
- **Bun compiler:** `bun build --compile` for standalone binary distribution

### Tool Provisioning (D-35)

All language-specific tools are declared as project dependencies and installed via standard package managers. Only `gitleaks` and `pre-commit` are global tools.

**TS/JS:** Quality tools added to `package.json` `devDependencies`:
- `eslint`, `prettier`, `vitest`, `@vitest/coverage-v8`, `knip`, `@stryker-mutator/core`, `eslint-plugin-security`, `eslint-plugin-import`, `typescript`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`
- Bun projects additionally include `better-npm-audit` (D-58 — Bun has no built-in audit command)
- Seed logger `pino` added as a `dependency` (not devDependency) — D-61

**Go:** Tools vendored via `tools/tools.go` blank import pattern + Makefile `go install` targets (version-pinned in `go.mod`, installed to `GOBIN`):
- `golangci-lint`, `deadcode`, `govulncheck`, `go-mutesting` (installed via `go install`)
- Custom analyzers built from source in `tools/go-analyzers/`

**Python:** Dev dependencies in `pyproject.toml` `[project.optional-dependencies.dev]`:
- `ruff`, `flake8`, `mypy`, `pytest`, `pytest-cov`, `pytest-crap`, `pip-audit`, `vulture`, `mutmut`
- Custom Flake8 plugin installed via `uv pip install -e tools/flake8-plugin/`

**Global tools (all languages):** `gitleaks`, `pre-commit` — documented in README with install instructions, checked by `anvil doctor`.

### Key Interfaces

#### ScaffoldContext (passed to engine)

```typescript
interface ScaffoldContext {
  projectName: string;
  lang: "typescript" | "golang" | "python";
  targetDir: string;
  hasExistingCode: boolean;
  skipSeed: boolean;           // on fresh init: user choice (defaults from hasExistingCode). On re-scaffold: loaded from lockfile.context.skipSeed (authoritative — NOT recomputed from hasCode)
  sourceDir?: string;          // detected source directory (src/, lib/, etc.)
  packageManager?: string;     // TS/JS only: npm, bun, pnpm, yarn (detected or prompted)
  defaultBranch?: string;      // for git hooks (default: main)
  nonInteractive: boolean;     // --non-interactive flag only (explicit opt-in; D-67 supersedes D-56)
}
```

**Context resolution precedence** (highest wins):
1. Explicit CLI flags (e.g., `--project-name`, `--package-manager`)
2. Stored `.anvil.lock` context (on re-scaffold only)
3. Fresh detection from disk (package manager from lockfile, source dir, hasCode)
4. Interactive prompts (unless `--non-interactive`)
5. Hard defaults (`projectName = basename(targetDir)`, `defaultBranch = "main"`, `skipSeed = hasCode`)

This prevents a cloned-into-different-dir re-scaffold from rewriting project identity.

#### LockfileEntry

```typescript
interface LockfileEntry {
  path: string;              // relative path from project root
  checksum: string;          // SHA-256 of file contents
}

interface AnvilLockfile {
  version: string;           // anvil version that generated these files
  lang: "typescript" | "golang" | "python";
  context: {                 // full generation context for deterministic re-render
    projectName: string;
    packageManager?: string; // TS/JS only
    defaultBranch: string;
    sourceDir?: string;
    skipSeed: boolean;       // authoritative persisted value. On re-scaffold, restored into ScaffoldContext.skipSeed (NOT recomputed from disk state)
  };
  files: LockfileEntry[];
  createdAt: string;         // ISO timestamp
  updatedAt: string;
}
```

Note: `source: "static" | "template" | "generated"` was removed from LockfileEntry — this was needed for 3-way merge provenance in update flows but is unnecessary with the idempotent re-scaffold model. `.anvil.lock` itself is NOT included in the `files[]` array (a file cannot checksum itself).

**Two-phase write model:** The FsTree stages all scaffold files in memory. After conflict resolution, `flushChanges(approvedChanges, targetDir)` writes only approved changes to disk sequentially (not transactionally — matching Nx's approach, which is safe because scaffold operations are idempotent). `.anvil.lock` is written separately after flush as a metadata step.

**Lockfile merge algorithm on re-scaffold:** The new lockfile is built path-by-path over the union of (prior lockfile paths) ∪ (current manifest paths):

| Classification | Source of entry in new lockfile |
|----------------|--------------------------------|
| In manifest, flushed (CREATE/UPDATE overwrite) | Checksum recomputed from freshly written file |
| In manifest, skipped during conflict resolution | Prior lockfile entry preserved as-is (checksum + path) |
| In manifest, unchanged on disk (FsTree dedup) | Checksum recomputed from disk (matches rendered content) |
| In prior lockfile, NOT in current manifest | **Pruned** — file remains on disk (anvil never deletes files) but is no longer tracked |
| In current manifest, NOT in prior lockfile | Added from freshly flushed file |

In `--dry-run` mode, neither files nor lockfile are written.

#### ConflictResolution

```typescript
type ConflictAction = "overwrite" | "skip" | "abort";

// "diff" is a prompt-time preview action, not a terminal resolution.
// Showing a diff re-prompts the user to choose overwrite, skip, or abort.
// ConflictResult only contains terminal actions.

interface ConflictResult {
  path: string;
  action: ConflictAction;
}
```

**`abort` behavior:** If any file conflict is resolved with `abort`, the scaffold exits immediately with code 1. No files are written to disk (neither CREATE nor UPDATE), no `.anvil.lock` is written, and no post-scaffold steps (install, git init, hooks) run. This is an all-or-nothing exit — approved files from earlier prompts are NOT flushed. The abort happens before `flushChanges()`, so disk state is unchanged.

**`diff` behavior:** When the user selects "diff" during a conflict prompt, the diff is displayed inline and the prompt repeats with the terminal options (overwrite / skip / abort). "diff" is never stored as a `ConflictResult`.

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
| `src/commands/doctor.ts` | Doctor command handler |
| `src/engine/tree.ts` | FsTree: in-memory virtual file system |
| `src/engine/render.ts` | Template rendering (EJS + static copy) |
| `src/engine/conflict.ts` | Per-file conflict prompts |
| `src/engine/lockfile.ts` | .anvil.lock management |
| `src/engine/detect.ts` | Existing project detection |
| `src/manifests/index.ts` | Per-language file manifest aggregator (D-43) |
| `src/manifests/*.ts` | Per-language file manifests |
| `src/engine/post.ts` | Post-scaffold tasks (package install, git hooks) |
| `src/generators/*.ts` | Per-language config generators |
| `src/templates/*.ejs` | EJS templates for dynamic configs |
| `static/*/` | Static files per language |
| `package.json` | Bun project config with dependencies |

### Workflow Changes

- Users run `anvil init` instead of manually configuring lint, git hooks, quality tools
- Users re-run `anvil init` to update files; FsTree auto-detects changes and prompts only for modified files
- Users run `anvil init --dry-run` to preview what would change without writing any files
- Users run `anvil doctor` to diagnose configuration issues

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Package manager install fails | Medium | Medium | Graceful error: scaffold succeeds, print manual install command |
| Existing project detection false positive (skips seed when it shouldn't) | Low | Low | Seed skip is prompted, user can override |
| .anvil.lock corruption | Low | Medium | Delete lockfile and re-run `anvil init` (fresh init heuristics re-detect context). Doctor reports missing lockfile as a warning. |
| Re-scaffold prompts too many files | Medium | Low | FsTree auto-dedup eliminates unchanged files; only genuinely modified files trigger prompts |
| EJS template syntax error in dynamic config | Low | High | All templates tested with snapshot tests |
| Bun standalone binary too large | Medium | Low | Strip unused modules. Binary size acceptable for dev tooling. |

## Testing Strategy

### Unit Tests
- `detect.ts`: test each language heuristic with fixture directories
- `lockfile.ts`: test read/write/checksum operations
- `conflict.ts`: test each conflict action
- `tree.ts`: test FsTree read/write/dedup/listChanges/flushChanges behavior
- `render.ts`: test template rendering with mock FsTree
- `generators/*.ts`: test each config generator outputs valid configs

### Integration Tests
- `anvil init --lang typescript` in temp dir → verify all files exist, lockfile correct
- `anvil init` on existing project → verify seed code skipped, tooling added
- `anvil init --dry-run` → verify no files written, changes printed to stdout
- `anvil init` re-run → verify only changed files prompted, unchanged files skipped
- `anvil doctor` with missing tool → verify correct diagnosis

### Snapshot Tests
- Each EJS template rendered with default context → snapshot of output
- Prevents accidental template regressions

### E2E Tests
- Full `init → lint → test → re-init` cycle per language
- Verify generated project passes its own lint rules
