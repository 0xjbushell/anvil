# Anvil — Design Decisions

Locked decisions for anvil v1. Each decision includes the choice, rationale, alternatives considered, and confidence level.

---

## D-01: Project scaffolding model — direct scaffold (no managed directory)

**Choice:** Anvil scaffolds files directly into standard project locations. No `.anvil/` managed directory.

**Rationale:** The user wants `anvil init` output to look identical to a manually-configured project. No black-box directories. Files live where a developer would put them (`eslint.config.mjs` at root, `tools/lint-rules/` for custom rules, `.github/workflows/ci.yml`, etc.).

**Tracking:** `.anvil.lock` at project root tracks which anvil version generated which files, enabling `anvil update` to diff and merge.

**Alternatives rejected:**
- `.anvil/` managed directory with eject — adds abstraction layer, doesn't match user's mental model
- No tracking at all — makes `anvil update` impossible

**Confidence:** High — user explicitly defined this model.

---

## D-02: Eject command — deferred to v2

**Choice:** No `anvil eject` in v1. Since files are scaffolded directly into standard locations, users already own everything.

**Rationale:** Eject solves "I want to customize managed files" — but there are no managed files in the direct-scaffold model. Users can modify any file. `anvil update` handles upstream changes via diff/merge against `.anvil.lock`.

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

**Default thresholds:**
- TypeScript/JS: 250 warn / 400 error
- Go: 350 warn / 500 error
- Python: 200 warn / 350 error

**Rationale:** Languages have genuinely different conventions. Go files tend to be longer (interface + implementation). Python values brevity. One-size-fits-all ignores this.

**Confidence:** Medium — thresholds may need tuning based on real-world usage.

---

## D-07: File organization — exported-only enforcement (Factory approach)

**Choice:** File organization rules (types in types file, errors in errors file, etc.) only flag **exported** declarations. Non-exported/private declarations can live wherever.

**Rationale:** Factory/Droid battle-tested this approach. Exported declarations are the module's public API — they should be organized. Private types used in one file don't need to be in a separate types file. Zero configuration, no escape hatches needed.

**Reference:** All four Factory rules use `schema: []` with exported-only checks.

**Confidence:** High — validated by production use at Factory.

---

## D-08: Init on existing projects — additive with smart detection

**Choice:** `anvil init` works on existing repos. It detects whether application code already exists using language-aware heuristics and skips seed code generation if so. Adds lint rules, configs, CI, Makefile, AGENTS.md with conflict prompts for existing files.

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

## D-14: CI platforms — GitHub Actions + Azure Pipelines

**Choice:** Generate CI workflows for both platforms.

**Rationale:** User needs both for their projects.

**Confidence:** High.

---

## D-15: TS/JS custom lint rules — ESLint v9+ flat config with local plugin

**Choice:** Custom rules shipped as a local ESLint plugin, imported directly in `eslint.config.mjs` via relative path.

**Rationale:** No npm publishing needed. Learning test LT1 validated that relative imports work in flat config. Cross-file analysis via `fs.existsSync` works. `context.filename` (not `getFilename()`) for ESLint v10+.

**Confidence:** High — validated by learning test.

---

## D-16: Go custom rules — `go vet -vettool` with multichecker.Main()

**Choice:** All custom Go analyzers combined into a single binary using `multichecker.Main()`, invoked via `go vet -vettool`. One binary, one pass over the codebase.

**Rationale:** golangci-lint v2 has NO module plugin system. Learning test LT2 confirmed this — no `custom-gcl.yml`, no way to load custom tools. `go vet -vettool` is standard Go infrastructure with zero third-party dependencies. Using `multichecker` (not `singlechecker`) avoids 17 separate passes over the codebase — one binary runs all analyzers in a single pass.

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

**Choice:** `anvil init` generates a small working module (e.g., `src/greeter/` or language equivalent) with correct file organization, tests, error handling, and structured logging.

**Rationale:** Agents follow existing convention really well. Seed code teaches by example — showing the agent how code should be structured. More effective than documentation alone.

**Confidence:** High.

---

## D-21: AGENTS.md — under 40 lines, complements lint

**Choice:** AGENTS.md is concise (under 40 lines), covers only what lint rules cannot enforce — judgment calls, testing strategy, validation commands, and reference pointers.

**Rationale:** Lint catches violations automatically; AGENTS.md covers the gaps. Bloated agent instructions are themselves slop.

**Confidence:** High.

---

## D-22: Scaffold engine architecture — hybrid (static files + programmatic configs)

**Choice:** Lint rule source files, seed code, and AGENTS.md are stored as static files (copied as-is). Config files that need customization (Makefile, CI workflows, eslint.config.mjs, pyproject.toml) are generated programmatically.

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

**Rationale:** Guessing the wrong package manager breaks install commands, CI workflows, and developer experience. Detection covers existing projects; prompting covers greenfield.

**Confidence:** High.

---

## D-30: `filename-match-export` — dropped for Go

**Choice:** STRUCT-07 (`filename-match-export`) applies to TypeScript and Python only. Dropped for Go.

**Rationale:** Go files routinely contain multiple exported symbols at package scope. "Primary export" is undefined in Go's package model. The rule would produce noisy, arbitrary results.

**Confidence:** High.

---

## D-31: JavaScript support — TS-first, JS supported

**Choice:** `--lang typescript` scaffolds TypeScript-first but also supports plain JavaScript projects. Seed code is `.ts`-only; ESLint config handles `.js`/`.mjs` files natively. Detection heuristics recognize existing `.js`-only projects and skip `tsconfig.json` strict type-checked rules if no `.ts` files exist. A `--lang javascript` alias is NOT added in v1 — the flag stays `typescript` and the scaffold adapts based on detection.

**Rationale:** ESLint flat config, Vitest, Prettier, and the custom plugin all work on both TS and JS. The only TS-specific artifacts are `tsconfig.json` and type-checked ESLint rules. Supporting JS requires minimal additional work and avoids an artificial limitation.

**Confidence:** High.

---

## D-32: Update merge model — 3-way merge via lockfile context

**Choice:** `anvil update` performs 3-way merge for modified files. The lockfile stores the full generation context (C1), enabling anvil to re-render the *original* template output (base version). The three inputs are: (1) base = re-rendered original template, (2) theirs = new template output, (3) ours = current disk content. If base matches disk → auto-apply new version. If base differs from disk → show 3-way diff and prompt.

**Rationale:** The context block in `.anvil.lock` makes deterministic re-rendering possible. 2-way merge (new vs disk) cannot distinguish user edits from upstream changes, leading to unnecessary prompts or silent overwrites.

**Confidence:** High.

---

## D-33: Update safety — check disk for new files

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

- **TS/JS:** All tools as `devDependencies` in `package.json` (eslint, prettier, vitest, knip, stryker, eslint-plugin-security, eslint-plugin-barrel-files). Global tools: `gitleaks`, `pre-commit` (documented in README, checked by `anvil doctor`).
- **Go:** Module-vendored tools in `tools/tools.go` using blank import pattern (`_ "github.com/golangci/golangci-lint/..."`), plus `go install` targets in Makefile. Global tools: `gitleaks`, `pre-commit`.
- **Python:** Dev dependencies in `pyproject.toml` `[project.optional-dependencies.dev]` installed via `uv pip install -e ".[dev]"` (ruff, flake8, mypy, pytest, pytest-cov, vulture, mutmut, bandit). Global tools: `gitleaks`, `pre-commit`.
- **CI:** Bootstrap steps explicitly install global tools (gitleaks via GitHub Action / binary download, pre-commit via pip/uv).

**Rationale:** Reproducible builds require pinned, declared dependencies. "Assume it's installed" fails on clean CI runners and new developer machines.

**Confidence:** High.

---

## D-36: STRUCT-01/02 implementation — clarified per language

**Choice:** File length and function length rules have different implementation strategies per language:

- **TS/JS:** Use ESLint built-in `max-lines` (STRUCT-01) and `max-lines-per-function` (STRUCT-02) — configured in aggressive lint config, NOT custom rules.
- **Go:** `funlen` linter in golangci-lint handles both file length (`lines`) and function length (`statements`) — configured in `.golangci.yml`. NOT custom analyzers.
- **Python:** Custom Flake8 checkers in `structural.py` for both (Python's Flake8 has no built-in equivalent with configurable thresholds).

These rules are config-driven for TS and Go (not counted in custom analyzer totals), custom-only for Python.

**Rationale:** Using existing tools avoids reimplementing well-solved problems. Only Python lacks a suitable built-in.

**Confidence:** High.
