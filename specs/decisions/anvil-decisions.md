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

- **TS/JS:** All tools as `devDependencies` in `package.json` (eslint, prettier, vitest, knip, stryker, eslint-plugin-security, eslint-plugin-import, typescript, @typescript-eslint/eslint-plugin, @typescript-eslint/parser). Seed logger: `pino` as a `dependency` (D-61). Bun projects also include `better-npm-audit` (D-58). Global tools: `gitleaks`, `pre-commit` (documented in README, checked by `anvil doctor`).
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

- **Pre-commit hook (Tier 1, <30s):** lint, format, typecheck, secrets — fires on `git commit`
- **Pre-push hook (Tier 2, <5min):** tests, coverage, deadcode, CRAP, audit — fires on `git push`
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

## D-58: Bun audit fallback

**Choice:** Bun does not provide a `bun audit` command. For Bun-managed TS/JS projects, the `make audit` target (Tier 2 / `make check`) uses `$(PKG_EXEC) better-npm-audit audit` as the audit command. `better-npm-audit` is added to `devDependencies` for Bun projects only (D-35). If the tool is not installed, the audit step fails (consistent with other missing tools).

**Rationale:** Bun's CLI has no audit subcommand. Rather than silently skipping security auditing, we use a well-maintained npm-compatible alternative. Making it a soft warning rather than hard failure prevents blocking development in environments where the fallback isn't installed.

**Confidence:** Medium — may switch to `socket` CLI or Bun-native audit if/when available.

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

**Offline mode:** If network is unavailable and no local toolchain installed, init fails fast with a clear message. No silent fallback to a stale floor.

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
