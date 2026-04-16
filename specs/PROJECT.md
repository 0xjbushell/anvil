# anvil

## What This Is

anvil is a CLI tool that scaffolds software projects for agentic development. It initializes repositories with custom anti-slop lint rules, aggressive lint configs, quality tooling (coverage, mutation testing, dead code detection, CRAP scoring), security linting, git hooks, seed code, and coding agent instructions — all directly in the agent's feedback loop.

## Core Value

Coding agents produce clean, maintainable, human-readable code because every quality signal is automated and blocking. The agent learns from seed code, gets corrected by lint rules, and is verified by quality gates — no human babysitting required.

## Requirements

See `REQUIREMENTS.md` for the full categorized list.

## Context

- Inspired by analysis of [slop-scan](https://github.com/nicholasgriffintn/slop-scan) (heuristic slop detection) and [Factory AI's eslint-plugin](https://github.com/anthropics/eslint-plugin) (agent-steering lint rules).
- slop-scan detects laziness patterns (empty catches, pass-through wrappers, placeholder comments). Factory enforces structural predictability (types in types.ts, filenames match exports). anvil ships both.
- Learning tests validated: ESLint flat config local plugins ✅, go vet -vettool custom analyzers ✅, Flake8 local plugins ✅, CRAP score pipeline ✅, Knip dead code detection ✅.

## Constraints

| Type | What | Why |
|------|------|-----|
| Runtime | Bun + TypeScript | Fast, good DX, matches team expertise |
| Distribution | npx + bunx + standalone binary | Go/Python devs shouldn't need Node; TS/JS devs use npx |
| Scaffold model | Direct scaffold into standard locations | No `.anvil/` managed directory; `.anvil.lock` tracks provenance |
| Languages | Go, TypeScript/JS, Python | Three most common agent-target languages. CLI flag uses `golang` (the ecosystem name); prose uses "Go" (the language name). |
| CI | Dropped — anvil owns the dev environment, not deployment (D-38) | Local-first: pre-commit + pre-push hooks replace CI as enforcement |
| TS/JS linting | ESLint v9+ flat config | Modern, supports local plugin import |
| Go linting | golangci-lint (config) + go vet -vettool (custom) | Module plugin system doesn't exist; go vet is standard |
| Python linting | Ruff (built-in rules) + Flake8 (custom plugins) | Ruff has no plugin system; Flake8 does |
| Python env | uv (virtualenv + package management) | Modern standard, avoids PEP 668 issues, same team as Ruff |
| Pre-commit | pre-commit framework (not husky) | Language-agnostic, multi-language projects |

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Go custom rules via go vet -vettool, not golangci-lint plugins | Learning test proved golangci-lint has no module plugin system | multichecker.Main() binary, one pass over codebase |
| File organization: exported-only enforcement | Factory battle-tested this approach | Private declarations stay wherever; exported must be organized |
| Direct scaffold model (no .anvil/ directory) | Output should look like a manually-configured project | .anvil.lock tracks provenance; anvil update diffs and merges |
| Init on existing projects: additive + smart detection | Most real usage is on existing repos | Language-aware heuristics skip seed code if app code exists |
| Structural rules default-on, not opt-in | Agents scattering types/errors everywhere IS slop | File organization rules ship enabled |
| Seed code as real src/, not examples/ | Agents learn from existing code, not docs | `seed` module in src/ demonstrates all conventions; no markers signaling disposability (D-37) |
| AGENTS.md complements lint, doesn't duplicate | Lint catches violations automatically | AGENTS.md covers judgment calls, validation commands, reference pointers |
| pre-commit over husky | Multi-language project needs language-agnostic hooks | pre-commit framework with per-language hooks |
| Three feedback tiers | Mutation testing too slow for pre-commit | pre-commit (<30s) → pre-push (<5min) → on-demand (make quality) |
| filename-match-export: TS/Py only (D-30) | Go packages export multiple symbols; "primary export" is undefined | STRUCT-07 dropped for Go, keeps TS/Python |
| Python env: uv (D-28) | PEP 668 blocks pip outside venvs; uv manages virtualenvs transparently | Makefile uses `uv run` / `uv pip install` |
| Package manager detection (D-29) | TS/JS ecosystem has 4 package managers | Detect from lockfile; prompt if not found |
| Go branch coverage: line-only (C3) | `go test -coverprofile` only supports statement coverage | AGENTS.md guides agents on branch coverage; no threshold enforced |
| Existing adoption: no special handling (D-24) | Agents fix violations iteratively — that IS the de-slop mechanism | No lint profile relaxation; init + `make lint` → agent fixes |
| JS support via TS flag (D-31) | ESLint/Vitest/Prettier handle both TS and JS natively | `--lang typescript` adapts for JS-only projects; seed code is TS |
| 3-way merge for updates (D-32) | Lockfile context enables re-rendering original templates | Distinguishes user edits from upstream changes; true smart merge |
| Update safety for new files (D-33) | Direct-scaffold model means user files may exist at new upstream paths | New upstream files prompt if disk path already exists |
| Source dirs configurable (D-34) | Existing projects use diverse layouts (`lib/`, `app/`, etc.) | Cross-file rules read source dir from lint config, not hardcoded |
| Tool provisioning explicit (D-35) | CI and clean machines need reproducible tool installation | All tools declared as project deps; only gitleaks/pre-commit are global |
| STRUCT-01/02 config-driven (D-36) | ESLint max-lines, golangci-lint funlen already solve file/function length | Custom checkers only for Python; TS/Go use existing tools |
| Seed module naming (D-37) | Agent must treat seed code as real code to mimic | Named `seed`, no comments/READMEs marking it disposable; human gets signal from CLI output only |
