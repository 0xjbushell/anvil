# Anvil — Design Decisions

Locked decisions for anvil v1. Each decision includes the choice, rationale, alternatives considered, and confidence level.

---

## D-01: Project scaffolding model — direct scaffold (no managed directory)

**Choice:** Anvil scaffolds files directly into standard project locations. No `.anvil/` managed directory.

**Rationale:** The user wants `anvil init` output to look identical to a manually-configured project. No black-box directories. Files live where a developer would put them (`eslint.config.mjs` at root, `tools/lint-rules/` for custom rules, `Makefile`, etc.).

**Tracking:** `.anvil.lock` at project root tracks which anvil version generated which files, enabling idempotent re-scaffold to detect changes.

**Alternatives rejected:**
- `.anvil/` managed directory with eject — adds abstraction layer, doesn't match user's mental model
- No tracking at all — makes re-scaffold change detection impossible

> **Note:** Update/merge references in the original rationale are superseded by D-39 (idempotent re-scaffold).

**Confidence:** High — user explicitly defined this model.

---

## D-02: Eject command — deferred to v2

> **Note:** The `anvil update` reference below is superseded by D-39 (idempotent re-scaffold). Users re-run `anvil init` instead.

**Choice:** No `anvil eject` in v1. Since files are scaffolded directly into standard locations, users already own everything.

**Rationale:** Eject solves "I want to customize managed files" — but there are no managed files in the direct-scaffold model. Users can modify any file. Re-running `anvil init` handles upstream changes via per-file prompts against `.anvil.lock` context.

**Confidence:** High.

---

## D-03: Go analyzer compilation — build on first lint

**Choice:** Ship Go analyzer source in `tools/go-analyzers/`. Makefile target builds the binary lazily on first `make lint`. Binary is gitignored.

**Rationale:** If you're writing Go, you have Go installed. No download infrastructure needed. Source is inspectable and modifiable. Build is transparent via Makefile.

**Alternatives rejected:**
- Build on init — delays init, no benefit since binary is needed at lint time
- Pre-built binaries — needs release pipeline for 4+ platform targets, adds distribution complexity

**Confidence:** High — validated by learning test LT2.

---

## D-04: `anvil doctor` — report + auto-fix non-destructive

**Choice:** Doctor automatically fixes safe issues (missing config keys, missing gitignore entries). Reports but does not auto-fix destructive changes (overwriting user-modified files, changing tool versions).

**Rationale:** Reduces friction for common issues while respecting user modifications. Safe middle ground.

**Alternatives rejected:**
- Report only — too passive, users want it to fix trivial things
- Full auto-fix — too aggressive, could overwrite intentional customizations

**Confidence:** High.

---

## D-05: Structured logging — pattern-based (any logger)

**Choice:** The `require-structured-logging` rule flags unstructured logging calls (console.log, fmt.Println, print) but accepts any structured logging library.

**Rationale:** Teams have different logging preferences. The rule should enforce "use structured logging" not "use this specific library." Seed code can use a default library as an example without the lint rule being coupled to it.

**Alternatives rejected:**
- Library-specific enforcement — too opinionated for a scaffolder used across teams
- Configurable — over-engineering for v1

**Confidence:** High.

---

## D-06: File size thresholds — language-tuned defaults, configurable

**Choice:** Ship language-specific defaults (Go higher, Python lower, TS middle). Users can override per-language in config.

**Default thresholds (error level, single threshold per tool limitation):**
- TypeScript/JS: 400
- Go: 500
- Python: 350

**Rationale:** Languages have genuinely different conventions. Go files tend to be longer (interface + implementation). Python values brevity. One-size-fits-all ignores this. Single error-level thresholds used because ESLint `max-lines` and Go `funlen` don't support dual warn/error thresholds in one rule instance. Teams wanting stricter enforcement lower the threshold.

**Confidence:** Medium — thresholds may need tuning based on real-world usage.

---

## D-07: File organization — exported-only enforcement (Factory approach)

**Choice:** File organization rules (types in types file, errors in errors file, etc.) only flag **exported** declarations. Non-exported/private declarations can live wherever.

**Rationale:** Factory/Droid battle-tested this approach. Exported declarations are the module's public API — they should be organized. Private types used in one file don't need to be in a separate types file. Zero configuration, no escape hatches needed.

**Reference:** All four Factory rules use `schema: []` with exported-only checks.

**Confidence:** High — validated by production use at Factory.

---

## D-08: Init on existing projects — additive with smart detection

**Choice:** `anvil init` works on existing repos. It detects whether application code already exists using language-aware heuristics and skips seed code generation if so. Adds lint rules, configs, git hooks, Makefile, AGENTS.md with conflict prompts for existing files.

**Detection heuristics:**
- Go: `.go` files, `go.mod`
- TypeScript/JS: `.ts`/`.js` files in src/lib/app, `package.json` with deps
- Python: `.py` files besides config files, `__init__.py` presence

**Rationale:** Most real-world usage will be on existing projects. Requiring an empty directory would severely limit adoption.

**Alternatives rejected:**
- Greenfield only — too limiting
- Always full scaffold — would conflict with existing code

**Confidence:** High.

---

## D-09: Update strategy — semver-aware

> **Superseded by D-39.** `anvil update` is deferred to v2. The semver strategy below applies to future update implementation.

**Choice:** `anvil update` applies minor/patch updates additively (new rules, config additions). Breaking changes only in major versions. `anvil update` refuses to cross major versions without `--force`.

**Rationale:** Users need confidence that `anvil update` won't break their setup. Semver provides clear expectations. Breaking changes are rare enough to warrant manual review.

**Confidence:** High.

---

## D-10: Python type checker — mypy

**Choice:** Anvil configures mypy for Python type checking.

**Rationale:** Mypy is the most widely adopted Python type checker. More developers know it. Lower adoption friction.

**Alternatives rejected:**
- pyright — faster but less adopted, different config format
- User picks at init — unnecessary complexity for v1

**Confidence:** High.

---

## D-11: Distribution — npx + bunx + standalone binary

> **Partially superseded by D-45.** v1 ships Bun-only (`bunx`) + compiled binary. npx distribution deferred.

**Choice:** Available via `npx anvil`, `bunx anvil`, and standalone compiled binary (via `bun build --compile`). Install script for binary (`curl -sSL | sh`).

**Rationale:** Go and Python developers shouldn't need Node/Bun installed to scaffold a project. Binary covers them. npx/bunx covers the TS/JS ecosystem naturally.

**Confidence:** High.

---

## D-12: CLI runtime — Bun + TypeScript

**Choice:** Built with Bun and TypeScript.

**Rationale:** Fast execution, good DX, TypeScript for type safety. Bun's built-in bundler enables standalone binary compilation.

**Confidence:** High — decided early in exploration.

---

## D-13: Supported languages — Go, TypeScript/JS, Python

**Choice:** v1 supports three languages. Others deferred.

**Rationale:** Most common languages used with coding agents. Covers the user's workflow.

**Confidence:** High.

---

## D-14: CI platforms — **DROPPED (superseded by D-38)**

**Original choice:** Generate CI workflows for GitHub Actions + Azure Pipelines.

**Superseded by D-38:** anvil no longer generates CI workflows. Enforcement moved to local git hooks (pre-commit + pre-push). Users add their own CI if needed — `make check` is CI-ready by design.

**Confidence:** High — user explicitly dropped CI generation.

---

## D-15: TS/JS custom lint rules — ESLint v9+ flat config with local plugin

**Choice:** Custom rules shipped as a local ESLint plugin, imported directly in `eslint.config.mjs` via relative path.

**Rationale:** No npm publishing needed. Learning test LT1 validated that relative imports work in flat config. Cross-file analysis via `fs.existsSync` works. `context.filename` (not `getFilename()`) for ESLint v10+.

**Confidence:** High — validated by learning test.

---

## D-16: Go custom rules — `go vet -vettool` with multichecker.Main()

**Choice:** All custom Go analyzers combined into a single binary using `multichecker.Main()`, invoked via `go vet -vettool`. One binary, one pass over the codebase.

**Rationale:** golangci-lint v2 has NO module plugin system. Learning test LT2 confirmed this — no `custom-gcl.yml`, no way to load custom tools. `go vet -vettool` is standard Go infrastructure with zero third-party dependencies. Using `multichecker` (not `singlechecker`) avoids 14 separate passes over the codebase — one binary runs all analyzers in a single pass.

**Confidence:** High — validated by learning test.

---

## D-17: Python custom rules — Flake8 plugin via pip install -e

**Choice:** Custom Python rules as a Flake8 plugin installed in editable mode.

**Rationale:** Ruff has no plugin system. Learning test LT3 validated that `pip install -e` works for local plugins. Error code prefix must be 1-3 uppercase letters (`ANV`).

**Confidence:** High — validated by learning test.

---

## D-18: Pre-commit framework — pre-commit (not husky)

**Choice:** Use the `pre-commit` framework for git hooks, not husky.

**Rationale:** Language-agnostic — works for Go, Python, and TS/JS. Single configuration for all languages.

**Confidence:** High.

---

## D-19: Structural rules — default-on

**Choice:** File organization, file length, function length rules are enabled by default, not opt-in.

**Rationale:** User explicitly stated: "File scatter IS slop." These rules should be on from day one.

**Confidence:** High.

---

## D-20: Seed code — real working code in conventional locations

**Choice:** `anvil init` generates a small working module (e.g., `src/seed/` or language equivalent) with correct file organization, tests, error handling, and structured logging.

**Rationale:** Agents follow existing convention really well. Seed code teaches by example — showing the agent how code should be structured. More effective than documentation alone.

**Confidence:** High.

---

## D-21: AGENTS.md — under 40 lines, complements lint

**Choice:** AGENTS.md is concise (under 40 lines), covers only what lint rules cannot enforce — judgment calls, testing strategy, validation commands, and reference pointers.

**Rationale:** Lint catches violations automatically; AGENTS.md covers the gaps. Bloated agent instructions are themselves slop.

**Confidence:** High.

---

## D-22: Scaffold engine architecture — hybrid (static files + programmatic configs)

**Choice:** Lint rule source files, seed code, and AGENTS.md are stored as static files (copied as-is). Config files that need customization (Makefile, eslint.config.mjs, pyproject.toml, .pre-commit-config.yaml) are generated programmatically.

**Rationale:** Most files are identical across projects. Only configs need customization. Clear separation: `static/{lang}/` for copy-as-is, `generators/{lang}.ts` for computed configs.

**Confidence:** High.

---

## D-23: Library stack — focused libraries (no scaffold framework)

**Choice:** Commander.js (CLI parsing) + @inquirer/prompts (interactive prompts) + EJS (template rendering) + Chalk (colored output) + Bun built-ins (file I/O, hashing).

**Alternatives rejected:**
- Yeoman — heavy dependency for init-time conflict resolution that takes ~40 lines to build manually. Doesn't help with update/doctor.
- Plop — designed for repeated micro-generation. Anvil is one-time init + occasional update. May revisit for v2 `anvil add` commands.
- Hygen — too simple, no programmatic control.

**Rationale:** Small dependency footprint. Full control over init/update/doctor workflows. `.anvil.lock` provides the provenance tracking that no scaffold framework offers.

**Confidence:** High.

---

## D-24: Existing-project adoption — no special handling

**Choice:** When `anvil init` runs on existing code, all rules fire at full severity. No baseline files, no "new files only" mode, no severity downgrade.

**Rationale:** The lint violations ARE the de-slop mechanism. Coding agents can fix hundreds of violations quickly — that's the whole point. Users can also disable rules they're not ready for via standard lint config. Suppression mechanisms add complexity and undermine the opinionated stance.

**Confidence:** High — user explicitly chose this model.

---

## D-25: Python exports — underscore convention

**Choice:** For Python structural rules (STRUCT-03 through STRUCT-08), "exported" means: if `__all__` is defined, use it; otherwise, any name NOT prefixed with `_` is considered exported.

**Rationale:** Python has no language-level export keyword. The underscore convention is the most widely understood Python privacy model. `__all__` is the explicit override. This matches how mypy, pyright, and Sphinx interpret public API.

**Confidence:** High — standard Python convention.

---

## D-26: Go enums — `enums.go` is canonical home

**Choice:** Go enum patterns (`type X int` + `const (... = iota)`) live exclusively in `enums.go`. The types-file-org and constants-file-org rules exempt iota-based enum declarations (identified by: `const` block using `iota` with a typed constant).

**Rationale:** Go enums are simultaneously a type and constants. Forcing developers to split them across `types.go` and `constants.go` would be anti-idiomatic. One canonical file mirrors how TS/Python seed code works.

**Confidence:** High.

---

## D-27: Go structured logging — allowlist known loggers

**Choice:** The Go `require-structured-logging` analyzer allowlists known structured logging packages: `log/slog`, `go.uber.org/zap`, `github.com/rs/zerolog`, `github.com/sirupsen/logrus`. Flags `fmt.Print*`, `log.Print*`, and string concatenation/formatting in any logger call.

**Rationale:** Go's type system and package-based imports make pattern detection feasible but require knowing which packages are structured loggers. An allowlist is explicit and extensible.

**Confidence:** High.

---

## D-28: Python environment — uv

**Choice:** Python projects use `uv` for virtual environment and package management. Makefile commands use `uv run` for execution and `uv pip` for installation. `anvil doctor` checks that `uv` is installed.

**Rationale:** uv is the modern Python standard (2025+) — 10-100x faster than pip, handles virtualenvs transparently, from the same team as Ruff. Avoids PEP 668 `externally-managed-environment` issues on modern Linux/macOS.

**Confidence:** High.

---

## D-29: Package manager detection — detect + prompt

**Choice:** For TS/JS projects, anvil detects the package manager from existing lockfiles (`bun.lock` → bun, `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn). If no lockfile found, prompt the user. Store the choice in `.anvil.lock` context block.

**Rationale:** Guessing the wrong package manager breaks install commands and developer experience. Detection covers existing projects; prompting covers greenfield.

**Confidence:** High.

---

## D-30: `filename-match-export` — dropped for Go

**Choice:** STRUCT-07 (`filename-match-export`) applies to TypeScript and Python only. Dropped for Go.

**Rationale:** Go files routinely contain multiple exported symbols at package scope. "Primary export" is undefined in Go's package model. The rule would produce noisy, arbitrary results.

**Confidence:** High.

---

## D-31: JavaScript support — TS-first, JS supported

> **JS-only detection deferred to v2 by D-46.** v1 generates TypeScript config that handles .js files natively. True JS-only support (skipping tsconfig, omitting type-checked rules) is post-v1.

**Choice:** `--lang typescript` scaffolds TypeScript-first. Seed code is `.ts`-only; ESLint config handles `.js`/`.mjs` files natively (linting works on both TS and JS without changes). v1 always emits `tsconfig.json` and type-checked ESLint rules. A `--lang javascript` alias is NOT added in v1 — the flag stays `typescript`. True JS-only support (detecting `.js`-only projects and conditionally skipping `tsconfig.json` / type-checked rules) is deferred to post-v1 per D-46.

**Rationale:** ESLint flat config, Vitest, Prettier, and the custom plugin all work on both TS and JS. The generated config handles mixed TS/JS codebases. Deferring true JS-only detection avoids conditional template logic complexity for a niche v1 use case.

**Confidence:** High.

---

## D-32: Update merge model — 3-way merge via lockfile context

> **Superseded by D-39.** 3-way merge is deferred to v2. v1 uses idempotent re-scaffold with per-file prompts instead.

**Choice:** `anvil update` performs 3-way merge for modified files. The lockfile stores the full generation context (C1), enabling anvil to re-render the *original* template output (base version). The three inputs are: (1) base = re-rendered original template, (2) theirs = new template output, (3) ours = current disk content. If base matches disk → auto-apply new version. If base differs from disk → show 3-way diff and prompt.

**Rationale:** The context block in `.anvil.lock` makes deterministic re-rendering possible. 2-way merge (new vs disk) cannot distinguish user edits from upstream changes, leading to unnecessary prompts or silent overwrites.

**Confidence:** High.

---

## D-33: Update safety — check disk for new files

> **Superseded by D-39.** The per-file conflict behavior described here is preserved in the re-scaffold flow (FsTree classifies UPDATE → prompt), but the `anvil update` command itself is deferred.

**Choice:** During `anvil update`, new upstream files (not tracked in `.anvil.lock`) that already exist on disk are treated as conflicts — prompt user to overwrite/skip/diff. Only truly new paths (no disk file, no lockfile entry) are created without prompting.

**Rationale:** Direct-scaffold model means users may have created files at paths that later versions of anvil want to use. Silent overwrite is data loss.

**Confidence:** High.

---

## D-34: Source directory — configurable in lint rules

**Choice:** Cross-file lint rules (`require-test-files`, `require-error-path-tests`) read source directory configuration from the project's lint config rather than hardcoding paths. Defaults match seed code layout (`src/` for TS/Python, `internal/`+`pkg/` for Go) but can be overridden.

For ESLint: rule option in `eslint.config.mjs`. For Go: analyzer flag. For Flake8: `--anvil-source-dir` option.

**Rationale:** Existing projects use diverse layouts (`lib/`, `app/`, top-level packages). Hardcoding `src/` breaks the "works on existing projects" promise.

**Confidence:** High.

---

## D-35: Tool provisioning — explicit install strategy per language

**Choice:** Each scaffolded project includes explicit tool installation in its setup:

- **TS/JS:** All tools as `devDependencies` in `package.json` (eslint, prettier, vitest, knip, stryker, eslint-plugin-security, eslint-plugin-import, typescript, @typescript-eslint/eslint-plugin, @typescript-eslint/parser). Seed logger: `pino` as a `dependency` (D-61). Bun projects use Bun's native audit command (D-58). Global tools: `gitleaks`, `pre-commit` (documented in README, checked by `anvil doctor`).
- **Go:** Module-vendored tools in `tools/tools.go` using blank import pattern (`_ "github.com/golangci/golangci-lint/..."`), plus `go install` targets in Makefile. Tools are version-pinned in `go.mod` and installed to `GOBIN` via `go install` — this is Go's standard project-local tool pattern. Global tools: `gitleaks`, `pre-commit`.
- **Python:** Dev dependencies in `pyproject.toml` `[project.optional-dependencies.dev]` installed via `uv pip install -e ".[dev]"` (ruff, flake8, mypy, pytest, pytest-cov, pytest-crap, vulture, mutmut, pip-audit). Bandit S rules are provided by Ruff's `S` rule set — no separate `bandit` package needed. Global tools: `gitleaks`, `pre-commit`.

**Rationale:** Reproducible builds require pinned, declared dependencies. "Assume it's installed" fails on new developer machines.

**Confidence:** High.

---

## D-36: STRUCT-01/02 implementation — clarified per language

**Choice:** File length and function length rules have different implementation strategies per language:

- **TS/JS:** Use ESLint built-in `max-lines` (STRUCT-01) and `max-lines-per-function` (STRUCT-02) — configured in aggressive lint config, NOT custom rules.
- **Go:** `funlen` in golangci-lint handles **function length only** (STRUCT-02) — configured in `.golangci.yml`, NOT a custom analyzer. **File length** (STRUCT-01) uses a custom analyzer in the `anvil-lint` binary (golangci-lint has no built-in file-length linter). STRUCT-01 IS counted in custom analyzer totals.
- **Python:** Custom Flake8 checkers in `structural.py` for both (Python's Flake8 has no built-in equivalent with configurable thresholds).

These rules are config-driven for TS/JS (not counted in custom totals). For Go, STRUCT-02 is config-driven but STRUCT-01 is a custom analyzer. Both are custom for Python.

**Confidence:** High.

---

## D-37: Seed module naming — `seed`, no disposability signals

**Choice:** The seed module is named `seed` (placed at `src/seed/` for TS/Python, `internal/seed/` for Go). It contains no comments, no README, and no markers indicating it is starter/disposable code. The agent must treat it as real production code to mimic.

**Rationale:** Agents follow patterns from existing code. If the seed contains comments like "this is just a starter" or a README saying "delete when ready," agents may deprioritize the patterns or reproduce those disclaimers in new code. The seed teaches by existing, not by explaining itself.

The human receives the disposability signal exclusively from CLI output at scaffold time — an ephemeral message the agent never sees:
```
✓ Created src/seed/ — conventions module.
  Safe to remove once your project has its own modules.
```

AGENTS.md references the seed path for file organization patterns but does not describe it as temporary.

**Alternatives rejected:**
- `greeter` — felt artificial and disconnected from user's actual project
- `_seed/` or `examples/` — outside standard source tree; agent wouldn't treat it as production patterns
- Comments/README in seed — risk changing agent behavior (ignoring or deprioritizing the patterns)

**Confidence:** High — user explicitly defined this model.

---

## D-38: Local-first enforcement — drop CI generation, use git hooks

**Choice:** anvil does not generate CI/CD workflows. All quality enforcement is local:

- **Pre-commit hook (Tier 1, fast local checks):** lint, format, typecheck, secrets — fires on `git commit`
- **Pre-push hook (Tier 2, slower safety net):** tests, coverage, deadcode, CRAP, audit — fires on `git push`
- **On-demand (Tier 3, `make quality`):** mutation testing — AGENTS.md instructs "run before marking work complete"
- **`make` targets** are the primary interface for agents. AGENTS.md instructs: "run `make lint` often during development, run `make check` before considering work done, run `make quality` before marking work complete" (D-55).
- **Git hooks** are safety nets that catch anything that slipped through, for both agents and humans. Agents trigger hooks naturally via `git commit` / `git push`.

**Rationale:** In the agentic development model, the agent's feedback loop is local. CI is a team/org infrastructure decision with too many variables (GitHub Actions vs Azure vs GitLab vs Jenkins, deployment targets, environments, approvals). Baking in opinionated CI couples anvil to platform choices, creates files users immediately customize or delete, and is outside anvil's core value prop (anti-slop guardrails for the dev environment).

`make check` is CI-ready by design — any team can add a one-line CI step. But that's their job, not ours.

**Supersedes:** D-14 (CI platforms — GitHub Actions + Azure Pipelines).

**Changes:**
- Removed `--ci` flag from `anvil init`
- Removed CI workflow templates (`.github/workflows/ci.yml`, `azure-pipelines.yml`)
- Removed CI bootstrap steps from D-35 tool provisioning
- Removed `ci` field from ScaffoldContext and AnvilLockfile
- Updated pre-commit config to include `stages: [pre-commit]` and `stages: [pre-push]`
- Updated SCAF-04 to cover both pre-commit and pre-push hooks
- Dropped SCAF-05 (CI workflows)

**Confidence:** High — user explicitly defined this model.


---

## D-39: Drop `anvil update` from v1 — idempotent re-scaffold instead

**Choice:** No `anvil update` command in v1. Users re-run `anvil init` on an existing project to get updated files. The FsTree virtual file system classifies every file as CREATE (new), UPDATE (changed), or no-op (unchanged) — prompting only for UPDATEs.

**Rationale:** 3-way merge (base/theirs/ours) is the hardest part of any scaffolder. Cruft's update is its buggiest feature. Cookiecutter has no update at all. Yeoman, Create React App, and most scaffolders are one-shot. By making `anvil init` idempotent, we get 80% of the value of an update command with 10% of the complexity. Users who modified a file get a per-file prompt; unchanged files are silently updated.

**What this eliminates:**
- `anvil update` command and `src/commands/update.ts`
- 3-way merge algorithm
- `.anvil/base/` directory for storing original template renders
- Per-file provenance tracking (`source: "static" | "template"`) in lockfile
- Semver-aware version comparison logic

**Alternatives rejected:**
- Full 3-way merge (Cruft model) — extremely complex, buggy in practice, Cruft's #1 issue category
- Diff-and-patch (git format-patch model) — fragile, breaks on minor whitespace changes

**Confidence:** High — user explicitly approved.

---

## D-40: FsTree virtual file system — in-memory staging (from Nx)

**Choice:** All scaffold file operations go through an in-memory FsTree. Changes are staged, classified (CREATE/UPDATE/DELETE), and flushed to disk. Adapted from Nx's `packages/nx/src/generators/tree.ts` (~466 LOC).

**Rationale:** FsTree gives us: (1) dry-run for free — render everything, print changes, write nothing; (2) re-scaffold for free — FsTree compares in-memory vs disk and auto-classifies; (3) idempotent writes — re-run fixes any partial state; (4) testability — inject FsTree in tests, no temp directories needed.

**Key behaviors (verified against Nx source):**
- Internal `recordedChanges` dictionary stages all writes in memory
- Smart dedup (Nx lines 184-191): if written content === existing disk content, change is removed (no-op)
- `listChanges()` (Nx lines 297-323): classifies CREATE (not on disk), UPDATE (on disk, different), DELETE
- `flushChanges()` is a **standalone function** (not a tree method) — writes files sequentially with recursive `mkdirSync`. Not transactional (matching Nx), but safe because scaffold operations are idempotent.
- Our interface omits Nx's `isFile()`, `children()`, `changePermissions()` — not needed for scaffolding
- Estimated ~200 lines of TypeScript

**Alternatives rejected:**
- Direct fs.writeFile (Hygen model) — no staging, no dry-run, no re-scaffold detection
- mem-fs/mem-fs-editor (Yeoman model) — heavyweight, 50+ transitive deps, vinyl-based

**Confidence:** High — validated by Nx source code analysis.

---

## D-41: Idempotent re-scaffold flow

**Choice:** Re-running `anvil init` on an existing anvil project:
1. Detects `.anvil.lock` → loads stored context (pre-fills prompts)
2. Renders all templates into FsTree (in-memory)
3. `tree.listChanges()` classifies every file automatically
4. CREATE files are added without prompting
5. UPDATE files trigger per-file prompts (overwrite / skip / diff-preview / abort)
6. Unchanged files are silently skipped (FsTree dedup)
7. Approved changes are flushed; lockfile is updated

**Rationale:** This makes `anvil init` safe to run multiple times — the FsTree handles all the complexity of detecting what changed. The per-file conflict UX comes from Yeoman's proven model.

**Confidence:** High.

---

## D-42: Core engine size estimate — ~800 LOC

**Choice:** Target ~800 lines of TypeScript for the core scaffold engine:
- `src/engine/tree.ts` (~200) — FsTree virtual file system
- `src/engine/render.ts` (~100) — EJS template rendering + static copy
- `src/engine/conflict.ts` (~80) — per-file conflict prompts
- `src/engine/lockfile.ts` (~60) — .anvil.lock read/write/checksum
- `src/engine/detect.ts` (~80) — project detection heuristics
- `src/manifests/index.ts` (~120) — per-language file manifest aggregator
- `src/cli.ts` (~100) — CLI commands
- `src/engine/post.ts` (~60) — post-scaffold tasks

**Rationale:** Hygen proves a scaffold engine can be ~600 LOC. Our FsTree adds ~200 LOC but eliminates the need for external file system abstraction libraries. Keeping the core small ensures agents can understand and modify it.

**Confidence:** Medium — estimates may shift during implementation.

---

## D-43: Manifest ownership — per-language files + aggregator

**Choice:** Each language has its own manifest file defining the files it generates (`src/manifests/typescript.ts`, `src/manifests/golang.ts`, `src/manifests/python.ts`). A shared aggregator (`src/manifests/index.ts`) loads the right manifest based on the `--lang` flag.

**Rationale:** Keeps language-specific file lists close to their generators. Adding a new language means adding one manifest file + one generator file. The aggregator is a simple switch/map.

**Alternatives rejected:**
- Single manifest file — grows unwieldy with 3 languages, harder to review
- JSON manifests — less flexible, can't compute paths dynamically

**Confidence:** High.

---

## D-44: Shared types ownership — TIX-000017

**Choice:** `src/types.ts` (shared TypeScript interfaces: ScaffoldContext, FsTree, LockfileEntry, etc.) is owned by TIX-000017 (CLI foundation ticket). All other tickets depend on it.

**Rationale:** Types must be defined before any implementation. Having a single owner prevents merge conflicts and ensures a consistent contract across the codebase.

**Confidence:** High.

---

## D-45: Distribution — Bun-only + compiled binary for v1

**Choice:** v1 distributes anvil via:
1. `bunx anvil` — primary distribution (requires Bun installed)
2. `bun build --compile` standalone binary — for users without Bun

npx/npm distribution is deferred. Bun is both the runtime and build tool.

**Rationale:** Anvil is built with Bun and uses Bun APIs. Supporting npm/npx requires transpilation to Node.js-compatible code. Not worth the complexity for v1. The compiled binary covers the "no Bun installed" case.

**Alternatives rejected:**
- npm + npx distribution — requires Node.js compatibility layer, doubles testing surface
- Docker distribution — overkill for a CLI tool
- Homebrew — platform-limited, packaging overhead

**Confidence:** Medium — may revisit if Bun adoption is lower than expected.

---

## D-46: JS-only project support — deferred to post-v1

**Choice:** v1's `typescript` language flag generates TypeScript configuration. ESLint config handles `.js` and `.mjs` files natively, but the scaffold assumes TypeScript. True JS-only support (skipping `tsconfig.json`, omitting type-checked rules) is deferred.

**Rationale:** YAGNI for v1. Most new JS projects should use TypeScript. The generated config works for mixed TS/JS codebases. True JS-only is a niche case that adds detection complexity and conditional template logic.

**Confidence:** Medium-High.

---

## D-47: Go STRUCT-03..06 — scaffold-only, not lint-enforced

**Choice:** File organization rules (types in `types.go`, errors in `errors.go`, constants in `constants.go`, enums in `enums.go`) are reflected in Go seed code and AGENTS.md guidance but are NOT enforced by custom Go analyzers.

**Rationale:** Go's idiomatic style places types, constants, and errors close to their usage within a package. Enforcing `types.go` via lint fights established Go conventions (e.g., `net/http` defines `Request` in `request.go`, not `types.go`). The seed code demonstrates the pattern for small modules; AGENTS.md recommends it; but lint doesn't enforce it.

**Alternatives rejected:**
- Enforce for Go anyway — fights Go conventions, high false-positive rate
- Skip entirely for Go — loses the teaching benefit of seed code structure

**Confidence:** High — Go community convention is clear.

---

## D-48: STRUCT-07 — single-export files only

**Choice:** The `filename-match-export` rule only applies to files that export exactly one symbol. Files with multiple exports are exempt — "primary export" is undefined when a file has multiple exports.

**Rationale:** Many legitimate files export multiple related items (e.g., a component + its props type, or a class + its factory function). Requiring filename match only for single-export files catches the clearest cases (file named `utils.ts` exporting only `formatDate`) while avoiding false positives.

**Confidence:** High.

---

## D-49: Re-exports don't count for file organization rules

**Choice:** `export { Foo } from './types'` (re-exports) do not count as "exported declaration" for STRUCT-03 through STRUCT-07. Only the definition site determines where a declaration must live.

**Rationale:** Barrel files (`index.ts`) and module entry points legitimately re-export types, constants, etc. from their canonical files. Counting re-exports would flag every `index.ts` that re-exports from `types.ts`.

**Confidence:** High.

---

## D-50: RULE-09 — `no-silent-error-swallow` (new rule)

**Choice:** Add RULE-09 to detect empty catch/except/recover blocks with no handling at all. This is distinct from RULE-01 (`no-log-and-continue`) which catches the "log-only" pattern. RULE-09 catches the worse pattern: complete silence.

**Detection:** Empty catch body (no statements, no comments explaining intentional suppression). Go: empty `if err != nil {}` blocks. Python: `except: pass`.

**Exception:** A comment explicitly explaining intentional suppression (e.g., `// intentionally ignored`, `// best-effort cleanup`) exempts the block.

**Confidence:** High — this is a well-known anti-pattern.

---

## D-51: CONFIG-01 owns `console.*`, not RULE-06

**Choice:** `console.log` / `console.warn` / `console.error` banning for TS/JS is handled by ESLint's built-in `no-console` rule (enabled in CONFIG-01's aggressive config). RULE-06 (`require-structured-logging`) is a complementary custom rule that catches structured-logger misuse — e.g., `logger.info('User ' + name)` instead of `logger.info('User logged in', { name })`.

**Rationale:** Using CONFIG-01's `no-console` for the obvious case avoids reimplementing a well-tested ESLint rule. RULE-06 adds value by catching the subtler pattern of using a structured logger incorrectly.

**Confidence:** High.

---

## D-52: RULE-07 index.ts exemption — all directory levels

**Choice:** `index.ts` / `index.js` files at any directory level are exempt from `require-test-files`. Not just the project root `index.ts`.

**Rationale:** Index files at any level serve as barrel files — they re-export from the directory, containing no business logic of their own. Testing them would mean testing re-exports, which is tautological.

**Confidence:** High.

---

## D-53: Go `break`/`continue` — NOT acceptable error handling

**Choice:** In Go's `if err != nil` blocks, `break` and `continue` are NOT considered acceptable error handling for RULE-09 (`no-silent-error-swallow`) purposes. They suppress the error silently — the caller gets no signal that an error occurred.

**Rationale:** `break` exits a loop, `continue` skips an iteration — neither propagates, wraps, or handles the error. At best, they silently skip a failed item. This is silent error swallowing — the error is discarded without logging, wrapping, or propagation.

**Acceptable Go error handling:** `return err`, `return fmt.Errorf("...: %w", err)`, explicit recovery logic, `log.Fatal(err)`.

**Confidence:** High.

---

## D-54: Test mapping — fixed conventions per language, no config for v1

**Choice:** RULE-07 (`require-test-files`) uses fixed directory/naming conventions per language:

- **TS/JS:** `src/{path}/{name}.test.ts` (co-located) or `src/{path}/__tests__/{name}.test.ts` (jest-style)
- **Go:** `{path}/{name}_test.go` (same directory — Go convention, non-negotiable)
- **Python:** `tests/test_{name}.py` (flat) or `tests/{module}/test_{name}.py` (mirrored)

No configuration for test directory mapping in v1. If the user uses a non-standard layout, they disable the rule.

**Rationale:** Convention over configuration. The fixed mappings cover 90%+ of projects. Adding configurable test paths doubles the complexity of a cross-file rule.

**Confidence:** Medium-High — may need config escape hatch in v2 if feedback demands it.

---

## D-55: Feedback tiers — lint before commit, check before push

**Choice:** Three feedback tiers with clear ownership:

| Tier | When | What | Target |
|------|------|------|--------|
| 1 | pre-commit hook | lint, format, typecheck, secrets | `make lint` + `make format` + `make typecheck` + `make security` |
| 2 | pre-push hook | Tier 1 + tests, coverage, deadcode, CRAP, audit | `make check` |
| 3 | on-demand | Tier 2 + mutation testing | `make quality` |

**Agent workflow** (driven by AGENTS.md):
- `make lint` → fast inner loop, run often during development
- `make check` → full validation (Tier 1 + Tier 2), run before considering work done
- `make quality` → full + mutation (Tier 3), run before marking work complete

**Hooks** are safety nets — they catch things agents/humans forgot. Agents drive quality via make targets.

**Confidence:** High — user explicitly defined this model.

---

## D-56: --non-interactive default resolution

> **Superseded by D-67.** The auto-non-interactive-on-non-TTY behavior is removed; mode is now opt-in via explicit `--non-interactive` flag only. Conflict handling moved from "default to skip" to "report + exit non-zero, no writes." Setup-prompt resolution chain (detected → lockfile → safe default) is preserved by D-67.

**Choice:** When `--non-interactive` is set (or stdin is not a TTY), all prompts are skipped. Default values use detection-first precedence:

| Prompt | Resolution |
|--------|-----------|
| `projectName` | Directory basename of target path |
| `packageManager` | Detected from lockfile (`bun.lock` → bun, `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn); falls back to `bun` if no lockfile |
| `defaultBranch` | `main` |
| `seed` | Skip if existing application code detected (`hasCode` heuristic); include otherwise |
| UPDATE conflicts | All default to `skip` (never overwrite without explicit consent) |
| Exit | Exit 0 with summary of what was scaffolded and what was skipped |

**Rationale:** Agents and CI systems run without a TTY. Defaults must be safe (never destructively overwrite) and deterministic (same inputs → same outputs). Detection-first means `--non-interactive` on an existing project preserves detected state rather than imposing arbitrary defaults.

**Confidence:** High.

---

## D-57: Barrel files allowed — `eslint-plugin-barrel-files` removed

**Choice:** `eslint-plugin-barrel-files` (`no-barrel-files` rule) is NOT included in CONFIG-01. Index/barrel files (`index.ts`/`index.js`) are an accepted organizational pattern.

**Rationale:** D-52 explicitly exempts `index.ts`/`index.js`/`index.mjs` at any directory level as legitimate barrel files. Including `no-barrel-files` in CONFIG-01 would contradict this — the same file pattern would be simultaneously allowed (RULE-07 exemption) and banned (CONFIG-01). Users commonly add barrel files as their project grows; the lint config should not prevent this.

**Confidence:** High.

---

## D-58: Bun audit

**Choice:** Bun-managed TS/JS projects use `bun audit --audit-level high` for the `make audit` target (Tier 2 / `make check`) and package `audit` script. Bun itself is the required audit tool for Bun projects; no npm-lockfile-based audit shim is added to `devDependencies`. If the audit command finds high or critical advisories, the step fails — same hard-fail policy as every other missing or failing required tool. `anvil doctor` is the supported recovery path (it runs the same command and tells the user to inspect failures).

**Rationale:** Bun now provides a native audit command that understands Bun lockfiles, while npm-lockfile-based shims fail in Bun-only projects. The high/critical threshold matches the generated quality gate's intent and avoids breaking clean scaffolds on low/moderate advisories in transitive dev tooling. Hard-failing high/critical audit failures is consistent with the rest of the toolchain (govulncheck, pip-audit, gitleaks all hard-fail when missing or failing) — soft-warning here would create a special case that lets severe supply-chain regressions slip through unnoticed.

**Confidence:** Medium — Bun audit behavior can still evolve, but using the package manager's native lockfile-aware command is the least surprising default.

---

## D-59: Directory lockfile prevents concurrent scaffold

**Choice:** `anvil init` acquires an exclusive process lockfile (`.anvil.lock.pid`) in the target directory before reading disk state. A second concurrent `anvil init` targeting the same directory exits immediately with an error. The lockfile is released after flush + `.anvil.lock` write completes (or on abort/error). Stale lockfiles are automatically reclaimed.

**Stale-detection algorithm:** The lockfile records `{ pid, startTime }` (process start time, ms-since-epoch). A lock is **live** iff the recorded PID is alive AND the live process's start time matches the recorded `startTime` — this defends against PID reuse. Otherwise the lock is stale (process is dead OR PID was reused) and is reclaimed. No wall-clock timeout is used.

**Rationale:** The scaffold pipeline reads disk state (classify CREATE/UPDATE), prompts, then flushes — a TOCTOU window exists between classify and flush. Without a lock, a concurrent scaffold or external file change can be silently overwritten. The PID + start-time lockfile is the simplest correct solution — no external dependencies, works on all platforms, and stale-lock recovery is automatic and PID-reuse safe.

**Confidence:** High.

---

## D-60: Cross-language re-scaffold is a hard error

**Choice:** If `.anvil.lock` exists and its `lang` field does not match the `--lang` flag, `anvil init` exits non-zero with a clear message: "This project was scaffolded for {lock.lang}. Cross-language migration is not supported in v1. Use a separate directory or delete .anvil.lock to start fresh."

**Rationale:** v1 lockfiles, templates, and generated configs are all single-language. Silently scaffolding a different language on top would create an unresolvable mess of conflicting configs. `anvil migrate` is the v2 path for this (D-04).

**Confidence:** High.

---

## D-61: Seed code logger choices

**Choice:** Each language seed module uses a specific structured logger:
- **TS/JS:** `pino` — lightweight, fast, structured JSON output, zero-config
- **Go:** `log/slog` — stdlib, no external dependency needed
- **Python:** stdlib `logging` — no external dependency, `logging.info("msg", extra={...})`

**Rationale:** Seed code must demonstrate structured logging patterns. Choosing zero-dependency or stdlib loggers avoids coupling the scaffold to a specific logging ecosystem opinion. Users can switch to their preferred logger — the lint rules enforce correct usage of any allowlisted logger, not a specific one.

**Confidence:** High.

---

## D-62: Add STRUCT-09 `no-barrel-density` (TS/JS)

**Choice:** Add a structural rule that flags `index.{ts,js,mjs,tsx}` files that are dominated by re-exports. Threshold: file has ≥3 `export ... from '...'` statements AND re-exports comprise >80% of top-level statements. Pure file-local AST analysis — no fs reads. TS/JS only (Go and Python idioms differ).

**Rationale:** Anvil's RULE-07 exempts `index.*` files from `require-test-files` because they are organizational barrels (D-52). Without an upper bound, a god-barrel `index.ts` re-exporting 50 symbols slips through every other rule. Slop-scan ships `barrel-density` as a default rule for this exact reason — agents love generating fat barrels. Implementing as an ESLint rule keeps the TS lint surface in one tool (no pluggable analyzers, no external scanner).

**Confidence:** High.

---

## D-63: Add STRUCT-10 `no-over-fragmentation` (TS/JS)

**Choice:** Add a directory-scope structural rule that flags directories dominated by tiny single-purpose wrapper files. Implementation uses an ESLint sentinel pattern: when ESLint visits a file, the rule checks if the file is the alphabetically-first non-test, non-index source file in its directory; if yes, the rule reads sibling files via `fs.readdirSync` + `fs.readFileSync` and computes directory metrics. This guarantees the rule fires exactly once per directory. Same fs-read pattern already used by RULE-07 and TEST-04.

**Thresholds:** Directory has ≥4 source files (excluding `*.test.*`, `index.*`, `__tests__/`) AND ≥60% of those files are "tiny" (<30 LOC stripping blanks/comments) with ≤1 export each. Skip allowlisted directory paths: `**/icons/**`, `**/assets/**`, `**/__generated__/**`, `**/migrations/**`. Allowlist configurable via rule option (`ignoreDirectories: string[]`).

**Rationale:** Anvil enforces "files too big" (STRUCT-01) but has no counterweight for "too many files too small." Slop-scan ships `over-fragmentation` because LLMs frequently split implementations into microscopic wrappers/forwards instead of cohesive modules. Implementing as an ESLint rule (vs. a separate scanner) preserves anvil's "one lint tool per language" rule (avoids splintering the agent guardrail surface). The sentinel pattern is the same approach already proven in RULE-07/TEST-04 — no new infrastructure.

**Confidence:** Medium-high. Threshold values may need tuning post-dogfood, but the architecture is sound.

---

## D-64: Toolchain version policy — "latest stable at init time, captured in lockfile"

**Choice:** Anvil does not pin hardcoded minimum versions for runtimes/SDKs. At `anvil init`, the engine resolves the **latest stable** version of each language toolchain via well-known sources and records the resolved version in the project's `anvil.lock` manifest. The lockfile is the source of truth from that point forward.

**Sources (in priority order, first match wins):**
- **Bun:** `bun --version` if installed, else fetch latest from `https://github.com/oven-sh/bun/releases/latest` (cached 24h)
- **Node:** latest LTS from `https://nodejs.org/dist/index.json` (filter `lts !== false`)
- **Go:** latest stable from `https://go.dev/dl/?mode=json` (first non-rc entry)
- **Python:** latest stable from `https://endoflife.date/api/python.json` (first entry where `eol > today`)

**Recorded in `anvil.lock`:**
```json
{
  "toolchain": {
    "bun": "1.2.x",         // present only if scaffold uses Bun
    "node": "22.x",
    "go": "1.24.x",
    "python": "3.13.x"
  }
}
```

**Engines fields / version files:**
- TS/Node: `package.json#engines.node`, `.nvmrc`
- Go: `go.mod` `go` directive
- Python: `pyproject.toml#requires-python`, `.python-version`

**Offline / network-failure mode:** Toolchain resolution makes outbound HTTP requests (Node, Go, Python sources). On any of these failure modes — DNS failure, timeout, non-200 response, certificate error — the engine falls back to a **bundled defaults snapshot** (`src/internal/toolchain-defaults.json`, refreshed in lockstep with each anvil release). The fallback is silent for the CLI's correctness but loud for the user: stderr emits `warning: could not reach <source> for latest <lang> version; using bundled default <version> from anvil <anvil-version>. Run online to refresh.` The resolved version is recorded in `.anvil.lock` exactly as if it had come from the network — re-scaffolds use the locked value, so an air-gapped re-scaffold of an existing project is fully deterministic and never touches the network at all. There is no `--offline-toolchain` flag and no separate "offline mode" — fallback is automatic.

For the **Bun source**, `bun --version` is checked first per the priority order above; if Bun is locally installed, the network is never consulted for Bun. The bundled defaults only apply to the languages whose primary source is remote (Node/Go/Python).

**Rationale:** Hardcoded floors rot. Pinning at init time + recording in lockfile gives reproducibility without forcing anvil maintainers to ship version bumps just to keep the floor current. Aligns with how `create-next-app`, `npm create vite`, and `cargo new` resolve toolchains.

**Confidence:** High.

---

## D-65: Anvil self-governance — license, dogfood, release process

**Choice:**
- **LICENSE:** MIT for anvil itself.
- **Dogfood:** Anvil ships its own `AGENTS.md` at the repo root, generated using the same template the TS scaffold emits. Anvil's repo passes its own `make check`.
- **Release process:** Conventional Commits → `release-please` (or equivalent) auto-maintains `CHANGELOG.md` and version bumps. Pushing a release tag triggers the release pipeline. No manual changelog entries.

**Rationale:** MIT is the lowest-friction choice for a developer tool; matches the OSS we're emulating (slop-scan, eslint-plugins). Dogfooding catches drift between scaffold output and what we'd actually want in a real repo. Conventional Commits + auto-changelog scales to multi-contributor without ceremony per PR.

**Confidence:** High.

---

## D-66: Scaffolded-project LICENSE and dependency automation — deferred to user/v2

**Choice:**
- **LICENSE in scaffolded projects:** Anvil does **not** create a LICENSE file or prompt for one. Users add their own per their org policy.
- **Dependabot/renovate config in scaffolded projects:** Deferred. Not generated in v1.

**Rationale:** License selection is a legal/org decision anvil shouldn't make. For dependency automation, the agent-era story is unsettled — coding agents may handle dep bumps directly via PR workflow rather than scheduled bots. Punting until we have real-world signal on what teams actually want here.

**Open question (revisit post-v1):** What does dependency hygiene look like when agents own most PRs? Is there still a role for scheduled bots, or does this collapse into the agent's normal work queue?

**Confidence:** High on v1 scope. Open question explicitly logged for v2.

---

## D-67: Non-interactive mode = explicit flag + conflict reporter; library choices; vendoring policy

**Supersedes D-56.** This decision combines three intertwined concerns: how `--non-interactive` mode behaves, what libraries anvil uses, and which libraries are vendored vs. installed.

### Part A — Non-interactive mode behavior

**Mode is opt-in only.** `--non-interactive` must be passed explicitly. The previous "auto-activate when stdin is not a TTY" behavior (D-56) is **removed** — pipe-without-flag is now a clean error rather than a silent mode switch. This eliminates the "silently did nothing" failure class.

**Setup prompts** resolve via the same precedence chain (flag → detected → lockfile → safe default). Greenfield runs in non-interactive mode work with no prompts.

**Conflict handling — anvil reports, the agent decides.**

When the FsTree classifies one or more files as `UPDATE` (template content differs from disk content) in non-interactive mode:

1. **No files are written** (CREATE files included — the run is all-or-nothing for safety, like a transaction)
2. **A structured report is printed to stderr**, including a unified diff per conflicting file (rendered via the `diff` library + `chalk` coloring)
3. **The process exits with a non-zero code**

Example output:
```
✗ 3 conflicts — anvil's templates differ from your local files.
  No files written.

────  Makefile  ────
- typecheck:
- tsc --noEmit
+ typecheck:
+ tsc --noEmit --strict

[... full unified diff per file ...]

To resolve: edit, delete, or leave the conflicting files, then re-run.
```

The agent (or human running headless) inspects the report and decides: edit the file to match anvil's version, `rm` it (anvil will recreate as CREATE next run), or leave it alone (next run will report the same conflict — honest, not silent).

**No `--on-conflict` flag.** Earlier proposals included `--on-conflict skip|overwrite|backup`. Dropped. The conflict reporter is the protocol; no need for a "force" knob, which would re-introduce the silent-skip / silent-overwrite failure modes we just eliminated.

**Lockfile semantics on conflict:** unchanged from current spec. Lockfile checksums update only when anvil successfully writes a file (CREATE or interactive overwrite). When the agent leaves a conflicting file alone, the lockfile checksum stays at the previous template version, and future re-scaffolds will report the same conflict. This is intentional — anvil never silently "accepts" a divergence.

**`--dry-run` is unaffected** — it works in any mode, never writes, prints classification + conflict diffs same as the non-interactive report. Useful for "what would this do?" inspection from any context.

### Part B — Library choices

Anvil prefers proven, widely-used libraries over hand-rolled code. Production dependencies (ship with anvil):

| Library | Purpose | Weekly DL |
|---|---|---|
| `commander` | CLI parsing | 375M |
| `chalk` | Terminal colors | 412M |
| `@inquirer/prompts` | Interactive prompts | (D-23) |
| `ejs` | Template rendering | 30M |
| `diff` (jsdiff) | Unified diff for conflict reporter | 98M |
| `write-file-atomic` | Crash-safe file writes (used by npm itself) | 85M |
| `picomatch` | Glob matching | 351M |
| `pino` | Structured logger (matches D-61 seed-code choice) | 28M |
| `zod` | Runtime schema validation (ScaffoldContext, fixture YAML) | 160M |

Dev dependencies (testing only, not shipped):

| Library | Purpose | Weekly DL |
|---|---|---|
| `yaml` | Fixture scenario format | 142M |
| `node-pty` | PTY-driven fixture harness for interactive flows | 6M (Microsoft-maintained) |

### Part C — Vendoring policy

Two libraries are **vendored** (copied into `src/internal/`) rather than installed:

| Library | Reason |
|---|---|
| `proper-lockfile` | Smaller community (12M/wk). Critical-path code. Pure JS — easy to vendor, simplify, convert to TS. |
| `dir-compare` | Smallest community on the list (2.5M/wk). Used only in fixture harness. Pure TS — trivial to vendor. |

**Vendoring process:**
1. Copy upstream source verbatim from a validated version (record version in a `README.md` next to the code)
2. Preserve original `LICENSE` file in the vendored directory
3. Convert to TypeScript if not already (with strict mode)
4. **Trim aggressively** — keep only the API surface anvil uses; delete unused features
5. Write our own tests covering the trimmed surface
6. Add the upstream copyright + license to a top-level `NOTICES.md`

**Layout:**
```
src/internal/
├── lockfile/         # vendored from proper-lockfile
│   ├── LICENSE       # original MIT
│   ├── README.md     # source repo, version, what was kept/dropped
│   ├── index.ts
│   └── *.test.ts
└── dir-compare/      # vendored from dir-compare
    ├── LICENSE
    ├── README.md
    ├── index.ts
    └── *.test.ts
```

**Why vendor these specifically?** Recent supply-chain incidents (event-stream, ua-parser-js, the xz playbook) consistently target small/medium packages with single maintainers — exactly the profile of these two. Vendoring small, stable utility code with simple APIs eliminates that attack surface at minimal cost (the trimmed code is small enough to read end-to-end in a code review).

**Why not vendor everything?** The larger libraries (commander, chalk, zod, etc.) have major-org consumers, multiple maintainers, and significant scrutiny — vendoring them would mean carrying a meaningful maintenance burden with no proportional security gain. `node-pty` is small but Microsoft-maintained and contains native bindings — vendoring would multiply complexity. The line is drawn at: **pure-source utility libs with low DL counts and simple APIs.**

### Rationale (overall)

- **Mode behavior**: explicit flag + conflict reporter satisfies the "anvil never decides for you" principle without being PTY-only (which would be unprecedented friction; no major scaffolder requires PTY)
- **Library choices**: every choice is industry-standard with major-project consumers; pulled live npm download data verified during D-67 drafting
- **Vendoring**: reduces real-world supply-chain risk on the weakest links without taking on disproportionate maintenance for the strong ones

### Confidence

High on Parts A and B. Medium-high on Part C — vendoring trim/maintenance burden is real but bounded and worth the risk reduction.

---

## D-68: Agent Inner Loop & Sandbox Test Harness

**Status**: Accepted
**Date**: 2026-04-23
**Related**: D-65 (anvil dogfoods AGENTS.md), D-67 (non-interactive conflict reporter), D-69 (OSS reference implementations)

### Decision

The anvil repository ships a sandbox + test harness explicitly engineered as the **coding agent's backpressure / feedback loop**. It is the substrate that makes agent-authored changes falsifiable. It has two modes that share the same input catalog:

**Mode 1 — Agent-driven exploration (primary).** The agent is mid-development, wants to try a change, and uses the sandbox as a real working environment:

```sh
bun dev re-scaffold-drift     # copies tests/fixtures/inputs/re-scaffold-drift → .sandbox/scratch, prints path
cd .sandbox/scratch
../../bin/anvil init --non-interactive
echo $?                       # agent inspects exit code
ls -la                        # agent inspects disk state
cat stderr.log                # agent inspects output
```

The agent is the judge. No harness, no goldens, no structured result file — the agent reads stdout/stderr and disk state directly, exactly as a human would. This is the fast, exploratory inner loop.

**Mode 2 — Automated regression net (supporting).** Pre-push and CI need a mechanical "did anything regress?" gate. Same input catalog, but assertions defined per scenario in YAML, evaluated by a small harness:

```sh
bun fixtures                  # run all scenarios, evaluate assertions, fail loudly on regression
bun fixtures --filter drift   # subset by scenario name
bun agent:check               # run only fixtures touching files changed in current diff
```

### Why assertion DSL, not directory snapshots

This was deliberated thoroughly. Surveyed the major scaffolders:

| Scaffolder | Test pattern |
|---|---|
| Yeoman | `yeoman-test` runs gen in temp dir; `yeoman-assert.file([...])`, `assert.fileContent(file, /regex/)` |
| Cookiecutter (`pytest-cookies`) | `cookies.bake()` → asserts on `result.project_path` |
| create-next-app | Jest runs CLI in temp dir; `fs.existsSync` + `JSON.parse(readFileSync)` content checks |
| cargo-generate | `assert_cmd` + manual `Path::exists` checks |
| Hygen | Jest snapshots, but only on individual rendered outputs (not directory trees) |

**No mature scaffolder snapshots the directory tree.** Three reasons consistently surfaced:

1. **Templates contain dynamic content** (timestamps, UUIDs, user names, ports) — full-tree snapshots churn constantly without scrubbing infrastructure.
2. **Reviewer pain** — a regenerated 200-file diff is noise; nobody can tell intentional from accidental.
3. **Asserting intent beats asserting bytes** — "package.json contains `typescript`" survives an irrelevant whitespace change; a snapshot doesn't.

Anvil follows the industry pattern. **Yeoman is the canonical reference implementation** (see D-69).

### What we give up

Snapshots catch unintentional changes in files we forgot to assert on. Two reframings dissolve this concern:

1. If a file isn't worth asserting on, it probably isn't worth byte-pinning either. Drift in unasserted files is caught by **unit tests on the rendering layer**, not by integration fixtures.
2. For the agent's inner loop specifically: an assertion failure is an actionable contract ("you broke the typescript dep contract"). A snapshot diff is a homework assignment ("47 bytes changed, which matter?"). The agent's signal is much cleaner with assertions.

We also **save the hermeticity tax** (clock injection, RNG seeding, deterministic FsTree ordering) — those are only required for byte-pinning.

### Layout

```
.sandbox/                          # gitignored scratch — agent's working area
   scratch/                        # default `bun dev` target; wiped on each run unless --keep
   <named>/                        # ad-hoc agent experiments

tests/fixtures/
   inputs/                         # starting-state catalog (committed)
      greenfield/                  # empty dir
      with-existing-code/          # has src/foo.ts, no .anvil.lock — exercises hasCode heuristic
      re-scaffold-clean/           # prior anvil run, no drift — should be no-op
      re-scaffold-drift/           # prior anvil run, user edited managed file — exercises conflict reporter
      re-scaffold-template-bumped/ # prior run, template changed (not user file) — exercises UPDATE classification
      partial-toolchain/           # has package.json, no tsconfig — exercises detection + safe defaults
      monorepo/                    # workspace already configured
      dirty-git-repo/              # uncommitted changes present
      hostile/                     # symlinks, read-only files, orphan .anvil.lock.pid

   scenarios/                      # one YAML per scenario (committed)
      greenfield-ts.yaml
      re-scaffold-drift.yaml
      ...

src/dev/                           # harness implementation
   cli.ts                          # `bun dev`
   fixtures.ts                     # `bun fixtures`, `bun agent:check`
   harness.ts                      # input copy → run anvil → evaluate assertions
   schema.ts                       # zod schema for scenario YAML
```

### Scenario YAML schema

Validated by zod. Yeoman-style assertion DSL.

```yaml
# tests/fixtures/scenarios/greenfield-ts.yaml
name: greenfield-ts
description: Fresh dir, init TS project non-interactively
input: greenfield                  # → tests/fixtures/inputs/greenfield/
args: [init, --lang, typescript, --non-interactive]
env:                               # optional env vars passed to anvil
  ANVIL_LOG_LEVEL: error
expect:
  exit_code: 0
  files_exist:
    - package.json
    - tsconfig.json
    - src/index.ts
    - .anvil.lock
  files_absent: []
  files_contain:
    - { file: package.json, matches: '"typescript"' }
    - { file: .anvil.lock, matches: 'version:' }
  files_match_regex:
    - { file: package.json, pattern: '"name":\s*"\w+"' }
  stderr_contains: []
  stderr_empty: true
  stdout_contains: []
```

```yaml
# tests/fixtures/scenarios/re-scaffold-drift.yaml
name: re-scaffold-drift
description: Re-run with locally edited managed file → conflict reporter fires, no writes
input: re-scaffold-drift
args: [init, --non-interactive]
expect:
  exit_code: 1
  stderr_contains:
    - "conflicts"
    - "Makefile"
  idempotent: true   # re-running on this same input must produce ZERO writes (no-op detection works)
```

Note: `idempotent: true` is **not** a directory snapshot of the templates (D-68 explicitly rejects those — see "Why we don't use snapshots" above). It asserts the engine's no-op detection: re-running anvil against an already-scaffolded project that the user has not edited produces zero filesystem writes. The "input" is a *prior scaffolded state*, not the template source. Implementation uses the vendored `dir-compare` (D-67) to compare on-disk state before and after the run; failure means either the engine wrote when it shouldn't have, or the templates produced non-deterministic content (see deterministic-templates rule below).
```

**Assertion vocabulary** (initial — extend as scenarios demand):
- `exit_code: <number>`
- `files_exist: [paths]` — fail if missing
- `files_absent: [paths]` — fail if present
- `files_contain: [{file, matches}]` — substring match
- `files_match_regex: [{file, pattern}]` — regex match
- `stdout_contains: [strings]`, `stderr_contains: [strings]`
- `stdout_empty: bool`, `stderr_empty: bool`
- `idempotent: bool` — running the scenario twice (or, equivalently, running it once on a directory whose state already matches expected post-scaffold) produces zero filesystem writes on the second run. Compares on-disk state before/after the second run via vendored `dir-compare` (D-67). Asserts the engine's no-op detection works correctly. **NOT** a template snapshot — see "Deterministic templates rule" below for what makes this assertion meaningful.

### Deterministic templates rule (v1)

The `idempotent` assertion only holds if templates are deterministic by construction — given the same `ScaffoldContext`, an EJS template MUST produce byte-identical output on every render. This means:

- **No timestamps.** Don't render `<%= new Date().toISOString() %>` into LICENSE year, README footer, generated-on comments, etc. If a year is required (LICENSE), source it from `ctx.year` set at init time and persisted in `.anvil.lock` (so re-scaffolds reuse the original year).
- **No UUIDs / random values.** No `crypto.randomUUID()`, no `Math.random()`. If a unique value is needed (e.g., a default API key placeholder), use a literal sentinel like `CHANGE_ME` or derive deterministically from `ctx.projectName`.
- **No environment-dependent output.** No `process.env`, no `os.userInfo()`, no `os.platform()`-conditional template branches. Anything environment-dependent must be resolved into `ScaffoldContext` at init time and locked.
- **No reading files outside `src/templates/<lang>/`.** A template MUST be a pure function of `ScaffoldContext`.

Templates that violate this rule cause `idempotent` fixtures to flap and break the engine's smart-dedup (`if writtenContent === diskContent → no-op`) — which is the actual bug `idempotent` exists to catch. If a v1 template genuinely needs non-determinism, add a **scrubber** (regex-replace before compare) to the affected fixture and document why; do not relax the templates rule globally.

### Interactive scenarios via `node-pty`

Some scenarios must drive interactive prompts (e.g., greenfield with prompts, re-scaffold conflict prompt loop). These use a `pty:` block instead of `args:` alone:

```yaml
name: greenfield-ts-interactive
input: greenfield
pty:
  command: [init, --lang, typescript]
  script:
    - expect: "Project name?"
      send: "myapp\r"
    - expect: "Default branch?"
      send: "\r"                    # accept default
    - expect: "Generate seed code?"
      send: "y\r"
    - expect_exit: 0
expect:
  files_exist: [package.json, src/index.ts]
```

`node-pty` is a dev-only dep (per D-67). The harness scrapes the pseudo-terminal output and matches against `expect:` patterns sequentially.

### CLI surface

| Command | Purpose |
|---|---|
| `bun dev <scenario> [--keep]` | Set up sandbox: copy `inputs/<scenario>/` → `.sandbox/scratch/`, print absolute path. `--keep` preserves prior contents. |
| `bun fixtures [--filter <substring>]` | Run all scenarios (or filtered subset); evaluate assertions; non-zero exit on any failure. |
| `bun agent:check` | Run a curated subset of fixtures: (a) every fixture whose scenario `input:` directory or referenced template files appear in `git diff --name-only HEAD`, AND (b) the FULL battery if any file under `src/scaffold/`, `src/internal/`, or `src/commands/init.ts` appears in the diff (engine code touches every fixture's behavior). The engine-changed branch is the safety net that prevents false-green when only core runtime changes. Silent on green. The agent's primary post-edit signal. |

### Pre-push and CI

- Pre-push hook runs `bun fixtures` (full battery — all scenarios). Yes, this can be slow. The principle (D-67 + this decision) is: agents and humans get a complete signal locally, never wait on a remote pipeline to schedule. If/when this becomes painful, optimize via parallelism, not by deferring to CI.
- CI re-runs `bun fixtures` from a clean checkout. Pre-push is skippable with `--no-verify`; CI is the untrickable gate.

### Agent guidance (AGENTS.md)

Per D-65, anvil dogfoods AGENTS.md. The sandbox harness is documented in the top-level `AGENTS.md` so coding agents discover the inner loop on their first read:
- "After every change, run `bun agent:check`."
- "To explore a change manually: `bun dev <scenario>` then `cd .sandbox/scratch && ../../bin/anvil ...`"
- "On regression: read the failed scenario YAML, read its `inputs/` starting state, reproduce in `.sandbox/scratch`, fix, re-run."

### Rationale (overall)

- **Agent backpressure as a first-class concern.** The sandbox is not a test framework that happens to be useful for agents; it is engineered as the agent's primary feedback surface, with the regression net as a side-effect of the same infrastructure.
- **Industry pattern.** Following Yeoman / Cookiecutter / create-next-app means the codebase will look familiar to anyone who has built or tested a scaffolder before — including agents trained on those codebases.
- **Cheap to extend.** Adding a new scenario is one YAML file plus an `inputs/<name>/` directory. No code, no rebuild, no goldens to bless.

### Confidence

High. Pattern is well-established across multiple scaffolders; the only unconventional choice (no snapshots) was reasoned through against the alternatives and matches what the major scaffolders actually do.

---

## D-69: OSS Reference Implementations as Agent Context

**Status**: Accepted
**Date**: 2026-04-23
**Related**: D-65 (AGENTS.md self-dogfood), D-67 (vendoring policy), D-68 (sandbox harness)

### Decision

When implementing components of anvil, **coding agents should study the corresponding OSS reference implementation first**, then write idiomatic code that follows the established patterns. This is policy, codified in `AGENTS.md` and per-ticket guidance.

The motivation: agent-authored code degrades when the agent invents conventions ad hoc. Pointing the agent at a battle-tested reference dramatically improves code quality, naming, and ergonomics — the agent has working examples to ground its choices in.

### Reference registry

Mapping anvil subsystems to canonical OSS implementations. Each entry includes the repo and what to study (read the linked code, not just the docs).

| Subsystem | Reference | What to study |
|---|---|---|
| **Test harness (assertions, temp dirs)** | [yeomanjs/yeoman-test](https://github.com/yeomanjs/yeoman-test), [yeomanjs/yeoman-assert](https://github.com/yeomanjs/yeoman-assert) | Assertion DSL shape (`assert.file`, `assert.fileContent`); test runner that creates an isolated temp dir per test |
| **Conflict prompts UX** | [yeomanjs/mem-fs-editor](https://github.com/yeomanjs/mem-fs-editor) + Yeoman's `Identical/Force/Skip` UX | The classic per-file conflict prompt and how mem-fs stages writes before commit |
| **Template rendering (EJS)** | [mde/ejs](https://github.com/mde/ejs) docs + Yeoman's `copyTpl` | Helpers, escape rules, error messages |
| **CLI structure** | [tj/commander.js](https://github.com/tj/commander.js), [vercel/next.js (`packages/create-next-app`)](https://github.com/vercel/next.js/tree/canary/packages/create-next-app) | Command/option/subcommand layout; how to keep `index.ts` thin |
| **Greenfield + integration tests** | [vercel/next.js `test/integration/create-next-app`](https://github.com/vercel/next.js/tree/canary/test/integration/create-next-app) | Patterns for running CLI in temp dir; asserting on generated `package.json`; smoke-running `npm run build` |
| **Headless scaffolder shape** | [cargo-generate/cargo-generate](https://github.com/cargo-generate/cargo-generate), [cookiecutter/cookiecutter](https://github.com/cookiecutter/cookiecutter) | Headless flag conventions (`--no-input`, `CI=1`); replay/config-file patterns |
| **File locking** | [npm/proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) (vendored — D-67) | Stale lock detection, retry policy, atomicity guarantees |
| **Directory comparison** | [gliviu/dir-compare](https://github.com/gliviu/dir-compare) (vendored — D-67) | Recursive walk, content vs metadata modes, filter callbacks |
| **Diff rendering** | [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff) | `createTwoFilesPatch` for unified diffs (used by conflict reporter — D-67) |
| **Atomic writes** | [npm/write-file-atomic](https://github.com/npm/write-file-atomic) | Temp-write + rename; permission preservation |
| **Logging** | [pinojs/pino](https://github.com/pinojs/pino) | Structured logging, child loggers, pretty-print transport |
| **PTY harness** | [microsoft/node-pty](https://github.com/microsoft/node-pty) + [microsoft/vscode (terminal subsystem)](https://github.com/microsoft/vscode) | Spawn/scrape; expect/send patterns for interactive scenario tests |
| **Schema validation** | [colinhacks/zod](https://github.com/colinhacks/zod) | Schema definition, custom error messages |
| **Glob matching** | [micromatch/picomatch](https://github.com/micromatch/picomatch) | Pattern syntax used in `.anvil.lock` ignore lists |
| **Conventional commits + release** | [googleapis/release-please](https://github.com/googleapis/release-please) (D-65) | Tag-triggered release pipeline pattern |

### Process

1. **Per ticket.** Each Deliverable ticket that has a clear OSS analog includes a `## Reference Implementation` section pointing at the repo + specific files to read.
2. **In `AGENTS.md`.** A top-level "Reference implementations" section gives agents the map and a directive: *"Before implementing X, read the corresponding reference. Where anvil's design diverges from the reference, the reasons are documented in the relevant decision (D-XX). Match the reference's idioms unless explicitly overridden."*
3. **In code comments.** Where an algorithm or interface is lifted directly from a reference, cite it inline:
   ```ts
   // Mirrors yeoman-assert.fileContent — single string or RegExp matching
   ```

### What this is not

- Not a license to copy code. Vendored code (D-67) is the only path for code lifting; reference implementations are for **patterns and idioms**, not source.
- Not a substitute for thinking. References inform; they don't dictate. When anvil diverges intentionally (e.g., D-67's "no `--on-conflict` flag" diverges from Yeoman's force/skip prompts), the divergence must be reasoned and documented.

### Rationale

Three failure modes this prevents:

1. **Agent ad-hoc invention.** Without a reference, agents tend to invent novel APIs that look reasonable in isolation but feel foreign next to ecosystem norms. References anchor the work.
2. **Documentation rot.** OSS reference repos are maintained; docs we write inline are not. Pointing at the source means the agent always sees current patterns.
3. **Onboarding cost.** A human reading anvil's source and seeing "modeled on yeoman-assert" instantly understands the shape. They can transfer Yeoman knowledge directly.

### Confidence

High. This codifies what experienced developers already do (study prior art); making it explicit policy ensures agents do it too.

---

## D-70: Crash recovery via lockfile-as-checkpoint + LF-only line endings

**Choice:**

**Part A — Lockfile-as-checkpoint (write order):** During `anvil init` (greenfield or re-scaffold), after conflict resolution and BEFORE any file write, the engine writes `.anvil.lock` to disk with `flushStatus: "in-progress"` and every intended entry's `status: "pending"` (intended checksums computed from in-memory rendered content). The engine then flushes files one by one via the vendored `write-file-atomic`; after each successful per-file write, the entry's `status` is updated to `"written"` and `.anvil.lock` is rewritten atomically. After every file flushes successfully, `.anvil.lock` is rewritten one final time with `flushStatus: "complete"`.

**Crash recovery contract:**
- `flushStatus: "complete"` → previous run finished cleanly. Normal re-scaffold path applies.
- `flushStatus: "in-progress"` → previous run was interrupted (process killed, ENOSPC, permission denied, etc.). On the next `anvil init`:
  - **Interactive:** prompt `Previous init was interrupted. Resume (re-flush pending entries)? [Y/n] / Abort?`. Resume re-renders templates, hashes, and writes only the entries still marked `"pending"`; checksum-mismatches on `"written"` entries are routed through the normal conflict path.
  - **`--non-interactive`:** fail with exit 1 and message `Previous init was interrupted. Re-run interactively to resume, or run 'anvil doctor' for details.` Silent resume in non-interactive mode would mask real bugs.
- `anvil doctor` reports any `flushStatus: "in-progress"` lockfile and lists pending entries.

**Part B — LF-only line endings:** All scaffolded text files use **LF (`\n`) line endings on every platform**, including Windows. Enforcement is two-pronged:

1. **Templated `.gitattributes`** at the project root, identical for every language scaffold:
   ```
   * text=auto eol=lf
   *.bat text eol=crlf
   *.cmd text eol=crlf
   *.png binary
   *.jpg binary
   *.gif binary
   *.ico binary
   *.woff binary
   *.woff2 binary
   ```
   This forces git to check files out with LF on Windows even when `core.autocrlf=true` is the user's global default. The `.bat`/`.cmd` exception preserves Windows shell scripts that genuinely require CRLF.

2. **Pre-hash text normalization** in the lockfile checksum pipeline: for any file classified as text (heuristic: `dir-compare`'s text/binary detection, or extension allow-list), the engine normalizes CRLF→LF and strips a single trailing `\r` before computing SHA-256. Binary files are hashed raw. This means a Windows user whose checkout briefly has CRLF (e.g., they edited in Notepad before the `.gitattributes` took effect) gets `doctor` reporting a clean checksum — provenance is line-ending-agnostic.

**Rationale:**

The previous spec (TIX-000017) said "no normalization" and the previous flush model wrote files first, lockfile last. Combined, those two choices guaranteed that:
- A crash mid-flush left the project with files but no `.anvil.lock` → re-running `init` saw every file as a conflict (CREATE-classified-as-new vs. existing-file-on-disk) with no provenance to resolve them.
- A Windows user with `core.autocrlf=true` saw permanent false UPDATE conflicts because every checkout converted LF→CRLF and the SHA-256 mismatched.

Both failure modes are silent and platform-asymmetric — the kind of bug that ships green and breaks in user repos. The combined fix: lockfile is the durable contract written first, and text checksums are line-ending-agnostic. This restores the "all-or-nothing" promise REQUIREMENTS.md makes (now via recoverability rather than transactional atomicity) and makes Windows a first-class supported platform.

**Why not staging-then-rename for atomicity?** Doubles disk usage during scaffold (every file lives twice momentarily) and breaks on cross-device renames (`/tmp` and `targetDir` can be different filesystems on Linux containers). The lockfile-as-checkpoint approach gives recoverability at lower cost.

**Why not eliminate `.bat`/`.cmd` exception?** Windows `cmd.exe` requires CRLF in batch files. We don't ship `.bat`/`.cmd` in v1 templates, but the `.gitattributes` is a safe default for user-added scripts.

**Confidence:** High. Both fixes are standard practice in mature scaffolders (e.g., create-react-app templates ship `.gitattributes` with `* text=auto eol=lf`).

---

## D-71: Required validation tools are hard failures, never skips

**Status**: Accepted
**Date**: 2026-04-30
**Related**: D-35 (tool provisioning), D-55 (feedback tiers), D-68 (sandbox harness), D-72 (Nix environments)

### Decision

Anvil validation must hard-fail when required tools for supported-language validation are unavailable. Contributor validation, e2e validation, fixture validation, and release validation do not skip required TypeScript, Go, or Python checks because the host environment is incomplete.

This applies to tools such as `uv`, `gitleaks`, `govulncheck`, `golangci-lint`, `staticcheck`, `deadcode`, Make, native build tooling needed by `node-pty`, and language runtimes required by supported scaffolds.

Generated project Makefiles follow the same rule: `make check` and `make quality` fail clearly if required tools are missing; they never silently omit required targets.

### Rationale

Anvil is itself a scaffolder for agentic engineering environments. If required tools are absent, a contributor cannot validate whether Anvil generated a working environment. Skips created false confidence during readiness review: the test suite could report green-ish status while Python e2e/parity or generated project `make check` paths were not actually exercised.

The right fix is to make the environment reproducible, not to weaken validation.

### Alternatives rejected

- **Contributor skips with release-only hard failures** — still lets day-to-day contributors merge changes without proving supported-language behavior.
- **Manual setup instructions only** — too fragile and artisanal; contributors and agents should not assemble validation environments by hand.
- **Generated Makefiles with conditional targets** — hides broken or incomplete toolchains from users.

### Confidence

High — user explicitly set this policy during release-readiness planning.

---

## D-72: Nix-provisioned contributor and e2e environments

**Status**: Accepted
**Date**: 2026-04-30
**Related**: D-28 (Python uv), D-35 (tool provisioning), D-71 (no skips)

### Decision

The Anvil repository provides Nix-backed, idempotent development environments for contributors, e2e sandboxes, and release validation. Contributors and CI use the same environment definitions through documented wrapper commands or package scripts.

Required flake outputs:

| Output | Purpose |
|---|---|
| `default` | Normal Anvil development |
| `release` | Full release-validation toolchain |
| `typescript-e2e` | TypeScript generated-project e2e validation |
| `golang-e2e` | Go generated-project e2e validation |
| `python-e2e` | Python generated-project e2e validation |

Generated projects also receive purpose-built, language-specific Nix environments. A TypeScript project gets TypeScript tooling, a Go project gets Go tooling, and a Python project gets Python tooling. Shared cross-language tools such as `gitleaks` are included only where the generated Makefile requires them.

### Rationale

Agents and contributors need a repeatable environment. Host-global installations create drift, stale tools, and skipped validation. Nix gives Anvil one source of truth for local validation, e2e sandboxes, and release CI.

Purpose-built generated environments preserve Anvil's direct-scaffold philosophy: users get a real project starting point they can build on, not a cross-language kitchen-sink environment.

### Alternatives rejected

- **Documenting manual installs** — brittle and not idempotent.
- **Docker-only environments** — useful for CI but weaker for local shell integration and generated project workflows.
- **One global environment for all generated projects** — installs irrelevant tools and contradicts language-specific scaffolding.

### Confidence

High — user explicitly requested automatic, idempotent Nix environments for contributors and e2e sandboxes.

---

## D-73: E2E fixtures must exercise real scaffold behavior

**Status**: Accepted
**Date**: 2026-04-30
**Related**: D-68 (sandbox harness), D-71 (no skips), D-72 (Nix environments)

### Decision

Committed fixture scenarios must prove real scaffold or re-scaffold behavior. A fixture scenario may run only `anvil --version` only when its explicit purpose is version behavior.

Fixture inputs may include `setup.sh`; the harness executes it after copying the input into the sandbox and before invoking Anvil. Setup failures fail the scenario.

E2E scenarios run inside the matching purpose-built Nix sandbox. Required-tool absence is an environment failure, not a skipped test.

### Rationale

Anvil's most important contract is that it can initialize and re-scaffold projects. Version-only fixtures gave false confidence because they did not exercise templates, lockfiles, generated Makefiles, dirty repos, hostile inputs, or language-specific tooling.

Setup scripts are the right way to create starting states that cannot be represented as static files alone, such as dirty Git worktrees, stale locks, permissions, or generated dependency state.

### Alternatives rejected

- **Keep smoke fixtures and rely on separate e2e tests** — splits the agent inner loop from the real proof path.
- **Directory snapshots for every fixture** — rejected by D-68; intent assertions provide clearer signal.
- **Host-global e2e setup** — violates D-72 and causes skipped validation.

### Confidence

High — directly follows the readiness audit and user guidance.

---

## D-74: Release validation proves installable distribution

**Status**: Accepted
**Date**: 2026-04-30
**Related**: D-45 (Bun-only + compiled binary), D-65 (release process), D-71 (no skips), D-72 (Nix environments)

### Decision

Release CI is the authoritative public-release gate. It runs inside the full Nix `release` environment, fails on required-tool absence, and proves that distribution artifacts are installable and functional.

Release validation must prove:

1. Full repo validation passes from a clean worktree.
2. TypeScript, Go, and Python generated-project e2e paths run without supported-language skips.
3. `bun run build` creates every installer-referenced binary asset.
4. A compiled host binary can scaffold a project from outside the repository, where repo-relative `static/` and `src/templates/` paths are unavailable.
5. `scripts/install.sh` resolves `latest` via `/releases/latest/download/<asset>` and pinned versions via `/releases/download/<version>/<asset>`.
6. The release workflow uploads every asset the installer expects.
7. Tix/spec hygiene for shipped scope is checked before release.

### Rationale

Passing `anvil --version` is not enough. Public users install Anvil to scaffold projects. The release process must prove the exact published binary can find scaffold assets and initialize real projects outside the source checkout.

The readiness audit found the installer, release asset workflow, and standalone binary behavior were not sufficiently proven. Release CI must close that gap.

### Alternatives rejected

- **Trust `bun run build` only** — produces binaries but does not prove runtime asset resolution.
- **Manual release checklist only** — prone to omission and not repeatable.
- **Release workflow without asset upload proof** — leaves installer and release assets disconnected.

### Confidence

High — directly addresses public-release blockers found by the package review.

---

## D-75: Public documentation and progressive agent-assisted adoption

**Status**: Accepted
**Date**: 2026-05-05
**Related**: D-01 (direct scaffold), D-08 (existing projects), D-21 (AGENTS.md), D-39 (idempotent re-scaffold), D-45 (distribution), D-55 (feedback tiers), D-65 (release process)

### Decision

Anvil's public release documentation is a static Astro Starlight site deployed through GitHub Pages. The root README remains a concise GitHub landing page and points to the published docs.

Agent-assisted adoption uses progressive instruction delivery:

1. The docs homepage exposes a tiny "copy prompt" call to action that tells a user's coding agent to fetch the hosted bootstrap prompt.
2. `/start.md` is the concise bootstrap prompt. It covers first install, install verification, optional Anvil skill installation, and a minimal fallback adoption flow.
3. The installable Anvil agent skill is the canonical ongoing operational protocol for using Anvil after bootstrap: install/update, adopt, re-scaffold, validate, troubleshoot, and maintain generated Anvil tooling.
4. Human docs explain the workflow and safety expectations, but do not duplicate the operational protocol.

### Non-overlap contract

| Artifact | Audience | Responsibility |
|----------|----------|----------------|
| Root README | Humans browsing GitHub | Project summary, install teaser, docs/release links |
| Docs site | Humans evaluating or using Anvil | Explanations, examples, reference, troubleshooting |
| `/start.md` | Coding agents during first adoption | Bootstrap only: install Anvil, offer skill install, hand off to skill or run minimal adoption |
| Anvil agent skill | Coding agents over the project lifecycle | Operational protocol for adopt/update/re-scaffold/validate/troubleshoot |
| Generated `AGENTS.md` | Coding agents inside scaffolded repos | Repo-local coding and validation conventions |

### Rationale

Public users should not need to read internal specs to understand Anvil. They need a normal OSS docs site with quickstart, installation, CLI reference, examples, and troubleshooting.

Coding-agent users need a different interface: concise, executable instructions with minimal token overhead. A bootstrap prompt alone is not enough because Anvil adoption continues after first install. The installable skill gives the user's coding harness durable Anvil knowledge without forcing every interaction to re-fetch a long prompt.

The explicit non-overlap contract prevents duplicated instructions from drifting or confusing agents.

### Alternatives rejected

- **README-only documentation** — too thin for public OSS adoption and examples.
- **One large prompt for everything** — wastes context and increases confusion during routine Anvil maintenance.
- **Skill-only adoption** — users still need a one-step bootstrap prompt that tells their current agent how to install Anvil and the skill.
- **Duplicated human docs and agent protocol** — creates drift and contradictory instructions.
- **Docusaurus or MkDocs for v1 docs** — both are viable, but Astro Starlight is static, polished, GitHub Pages friendly, and aligned with Anvil's TypeScript/Bun ecosystem.

### Confidence

High for the docs-site and artifact-boundary model. Medium-high for the portable skill distribution details because coding harnesses differ, but the skill can start as a Markdown protocol with harness-specific install instructions documented separately.

---
