# Scaffold Engine & CLI Commands

## Traceability

- **Shared Key**: `scaffold-engine`
- **Spec Path**: `specs/cli/scaffold-engine.md`
- **Requirement Refs**: `CLI-01`, `CLI-03`, `CLI-04`, `CLI-05`, `CLI-06`, `CLI-07`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-01, D-03, D-04, D-08, D-22, D-23, D-29, D-31, D-35, D-39, D-40, D-41, D-42, D-43, D-45, D-58, D-59, D-60, D-61, D-64, D-65, D-67, D-68, D-69; superseded: D-02, D-11, D-32, D-33, D-56)

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

> **Reference implementations (D-69):** Several engine modules have canonical OSS implementations agents should study before coding — FsTree → Nx; conflict UX → Yeoman / mem-fs-editor (see D-67 for where anvil deliberately diverges); rendering → mde/ejs; CLI shape → tj/commander.js + vercel/create-next-app; locking → npm/proper-lockfile (vendored); directory comparison → gliviu/dir-compare (vendored). See D-69 for the full registry.

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
- **`flushChanges()`** (Nx lines 436-450, anvil-modified): standalone function that writes changes to disk sequentially via the vendored `write-file-atomic`. Unlike Nx (which flushes all recorded changes), anvil's `flushChanges()` accepts a filtered `FileChange[]` — only changes approved during conflict resolution are flushed. Skipped files are simply omitted from the list. **Per-file write atomicity** is provided by `write-file-atomic` (write-tmp + fsync + rename); **batch atomicity** is provided by D-70's lockfile-as-checkpoint contract — `.anvil.lock` is written FIRST with `flushStatus: "in-progress"` and per-entry `status: "pending"`, then each successful per-file flush updates that entry to `"written"`, and the final lockfile rewrite sets `flushStatus: "complete"`. A crash mid-flush leaves a recoverable checkpoint, not a black hole.
- ~200 lines of TypeScript for our simplified version

**FsTree and .anvil.lock:** FsTree does NOT manage `.anvil.lock`. The lockfile is read separately by `lockfile.ts` for re-scaffold context (pre-filling prompts with previous values), and written separately after flush as a metadata step. FsTree's `listChanges()` and `flushChanges()` never include `.anvil.lock` in their scope.

**Lockfile checksums during re-scaffold:** Existing checksums in `.anvil.lock` are used for **integrity checking** (`anvil doctor` verifies file checksums match) and **provenance** (tracking what anvil generated), NOT for conflict detection. FsTree's 2-way comparison (new template vs disk) handles change classification. The lockfile's primary re-scaffold role is providing stored context (project name, package manager, etc.) to pre-fill prompts.

**`--non-interactive` exit code (D-67 supersedes D-56):** When `--non-interactive` mode (explicit flag only) encounters one or more `UPDATE` conflicts, the CLI prints a structured unified-diff report to stderr and exits **non-zero with no files written** (all-or-nothing transaction — including any `CREATE` files). When there are no conflicts, the CLI writes all classified changes and exits 0. If everything is no-op (nothing to do), exit 0 with a "no changes" message.

**Error handling:**
- **Template render failure:** Aborts before `flushChanges()`. No files written, no lockfile, no post-steps. Exits non-zero with error message identifying the failing template path.
- **Partial flush failure** (e.g., permission denied, ENOSPC): The lockfile already exists with `flushStatus: "in-progress"`; the in-progress write of the failing file is rolled back by `write-file-atomic`'s tmp+rename (no partial bytes on disk). Exits non-zero. Recovery: re-run `anvil init` — the engine detects `flushStatus: "in-progress"`, resumes pending entries (interactive) or fails with a clear "previous init incomplete" message (`--non-interactive`). Per D-70.
- **Post-install failure** (e.g., npm install fails): Scaffold files and lockfile are already written (`flushStatus: "complete"`). Prints manual install command. Exits 0 (scaffold succeeded; install is best-effort).

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
    │  Git setup (ORDER MATTERS):  │
    │  1. If no git binary: warn   │
    │     and skip steps 2-4       │
    │  2. If no .git: run git init │
    │     (MUST precede step 4 —   │
    │     pre-commit install needs │
    │     a git repo to write to   │
    │     .git/hooks/)             │
    │  3. If pre-commit not found: │
    │    warn "pre-commit not      │
    │    installed — hooks skipped. │
    │    Install: pip install       │
    │    pre-commit" and continue  │
    │  4. Run pre-commit install   │
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
- Bun projects use `bun audit --audit-level high` rather than an npm-lockfile audit shim (D-58)
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
  toolchain: {                 // resolved at init time per D-64; populated only for languages present
    bun?: string;              // e.g., "1.1.30" — present whenever anvil itself runs (always)
    node?: string;             // e.g., "20.18.0" — present for typescript projects
    go?: string;               // e.g., "1.23.4" — present for golang projects
    python?: string;           // e.g., "3.13.0" — present for python projects
  };
  anvilVersion: string;        // from package.json
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
  checksum: string;          // SHA-256 of file contents (post-LF-normalization for text files; D-70)
  status: "written" | "pending";  // "pending" only during in-progress flush; "written" on success (D-70)
}

interface AnvilLockfile {
  version: string;           // anvil version that generated these files
  lang: "typescript" | "golang" | "python";
  flushStatus: "complete" | "in-progress";  // checkpoint marker for crash recovery (D-70)
  context: {                 // full generation context for deterministic re-render
    projectName: string;
    packageManager?: string; // TS/JS only
    defaultBranch: string;
    sourceDir?: string;
    skipSeed: boolean;       // authoritative persisted value. On re-scaffold, restored into ScaffoldContext.skipSeed (NOT recomputed from disk state)
    year: number;            // captured at first init; reused on re-scaffold (deterministic-templates rule, D-68)
  };
  toolchain: {               // resolved at init time per D-64; mirrored from ScaffoldContext.toolchain
    bun?: string;
    node?: string;
    go?: string;
    python?: string;
  };
  files: LockfileEntry[];
  createdAt: string;         // ISO timestamp
  updatedAt: string;
}
```

Note: `source: "static" | "template" | "generated"` was removed from LockfileEntry — this was needed for 3-way merge provenance in update flows but is unnecessary with the idempotent re-scaffold model. `.anvil.lock` itself is NOT included in the `files[]` array (a file cannot checksum itself).

**Two-phase write model with checkpoint (D-70):** The FsTree stages all scaffold files in memory. After conflict resolution, the engine writes the lockfile FIRST with `flushStatus: "in-progress"` and every entry's `status: "pending"` (intended checksums computed from in-memory rendered content). `flushChanges(approvedChanges, targetDir)` then writes each approved file sequentially via the vendored `write-file-atomic`; on each successful per-file write the entry's `status` is updated to `"written"` and the lockfile is rewritten atomically. After every file flushes successfully, the lockfile is rewritten one final time with `flushStatus: "complete"`.

**Crash recovery:** If `anvil init` crashes mid-flush (process killed, ENOSPC, permission denied), the on-disk lockfile is left with `flushStatus: "in-progress"` and a mix of `"written"` and `"pending"` entries. On the next `anvil init` invocation, the engine detects this state and offers two paths:

1. **Resume:** re-render templates, hash, and write only the entries still marked `"pending"` (skip already-`"written"` entries whose on-disk checksum matches the lockfile entry; treat checksum-mismatches as conflicts via the normal conflict path). On success, mark `flushStatus: "complete"`.
2. **Abort + reconcile:** `anvil doctor` reports the in-progress state and lists pending entries. User can manually delete the partial lockfile to start clean.

The default in interactive mode is to prompt for resume vs. abort. The default in `--non-interactive` mode is to **fail with a clear "previous init incomplete; run `anvil doctor` or re-run interactively" message** — silent resume in non-interactive mode would mask real bugs.

**Resume guard — anvil version mismatch:** Before resuming, the engine compares the `version` field in the on-disk lockfile against the currently-installed anvil version. If they differ AND `flushStatus: "in-progress"`, the engine **refuses to resume** even in interactive mode and prints: `"Cannot resume: lockfile written by anvil X.Y.Z, current version is A.B.C. Resuming would mix old written files with newly-rendered template output. Run \`anvil doctor\` for reconciliation guidance."` Rationale: between crash and resume, the user may have upgraded anvil; templates may have changed; resumed-write content would diverge from already-written content for the same logical entry, producing a silently-broken project.

**Recovery — `flushStatus: "in-progress"` with zero pending entries:** Rare crash window between the last `markEntryWritten` (which sets the final `"pending"` → `"written"`) and `finalizeLockfile` (which sets `flushStatus: "complete"`). All files exist on disk; only the final atomic lockfile rewrite was lost. The engine handles this automatically (no user prompt): verify each entry's on-disk checksum matches the lockfile-recorded checksum. If all match → call `finalizeLockfile` and proceed normally. If any mismatch → fall through to the standard resume/abort flow (user-modified files in this window are treated as conflicts).

**Why lockfile-first instead of staging-then-rename:** Staging-then-rename gives stronger atomicity but doubles disk usage during scaffold (every file lives twice momentarily) and complicates cross-device renames (`/tmp` and `targetDir` can be different filesystems). The lockfile-as-checkpoint approach gives recoverability without the disk doubling, at the cost of allowing partial state to exist transiently. Recovery is the path that makes partial state tolerable.

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
| EJS template syntax error in dynamic config | Low | High | Per-template render tests assert each template renders cleanly with default context (see "Per-Template Render Tests" below). Per D-68, anvil rejects directory-tree snapshots in favour of an assertion DSL — but per-template render assertions remain valid as unit-level rendering tests. |
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

### Per-Template Render Tests
- Each EJS template rendered with default context → assert the rendered string contains expected key tokens (e.g., the project name, the resolved toolchain version, required config keys).
- Per D-68, anvil rejects directory-tree snapshots in favour of an assertion DSL (`bun fixtures`). Per-template render assertions remain valid as unit-level rendering tests — see D-68 §"Hygen" row in the scaffolder survey for prior art.
- Prevents accidental template regressions without coupling tests to whitespace-level output.

### Sandbox Harness (D-68)

The agent inner loop and CI regression net both run through `bun fixtures` / `bun agent:check` / `bun dev` against `tests/fixtures/scenarios/*.yaml` (scenario YAML + assertion DSL — no directory snapshots; per D-68). The engine itself must be invokable in scenarios — i.e., `bin/anvil init --non-interactive` (and re-scaffold variants) from a temp directory with stdout/stderr/exit-code captured. See D-68 for the assertion vocabulary and CLI surface, and `tests/fixtures/inputs/` for the catalogue of starting-state example projects. Scenario assertions cover file existence/content, lockfile shape, conflict-reporter output, and re-scaffold idempotence.

### E2E Tests
- Full `init → lint → test → re-init` cycle per language, exercised via the D-68 harness scenarios.
- Verify generated project passes its own lint rules.
