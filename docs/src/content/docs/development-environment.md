---
title: Development Environment
description: The tools, rules, and agent operating model Anvil generates into projects.
---

This page describes the **generated project development environment**, not the Anvil contributor environment used to build Anvil itself. After `anvil init`, the project owns ordinary files in ordinary locations: a language-specific `flake.nix`, a unified `Makefile`, pre-commit hook configuration, lint/test/audit tooling, `AGENTS.md`, `.anvil.lock`, and seed/reference code when the repository is greenfield.

The environment exists to create backpressure for humans and coding agents. A prompt can say "write clean code"; Anvil turns that preference into local tools that reject vague comments, weak error handling, missing tests, unused code, insecure dependencies, and other drift before review.

## What Anvil creates

| Surface | What it does | Why it matters |
| --- | --- | --- |
| `flake.nix` | Provides the language-specific Nix development shell plus shared tools such as Git, Make, `gitleaks`, and `pre-commit`. | Agents should not assemble artisanal host environments. The generated shell makes validation reproducible. |
| `Makefile` | Exposes the same target names for every supported language: `lint`, `format`, `typecheck`, `security`, `test`, `coverage`, `deadcode`, `crap`, `audit`, `mutate`, `check`, `quality`, and `fix`. | Humans, agents, hooks, and CI can all use one command vocabulary even though the underlying tools differ. |
| `.pre-commit-config.yaml` | Wires pre-commit and pre-push safety nets around the Makefile targets. | Hooks catch forgotten checks, but agents should run the Make targets proactively before hooks fire. |
| `AGENTS.md` | Gives repo-local instructions: where to find examples, which commands to run, and how to treat validation failures. | Agents get a bounded local operating model instead of relying on a generic system prompt. |
| `.anvil.lock` | Records Anvil version, language, scaffold context, toolchain versions, generated-file checksums, and write status. | Re-running `anvil init` can classify generated-file changes safely and avoid blind overwrites. |
| Seed/reference code | Demonstrates file organization, typed errors, constants, enums, structured logging, and tests. | Agents learn conventions from real code in the repository, not from abstract style guidance. |

Generated project validation follows the same policy as Anvil itself: **required tools are hard requirements**. `make check` and `make quality` should fail clearly when a required tool is missing; they must never silently omit required targets. When in doubt, run through Nix:

```bash
nix develop path:. --command make check
```

## Tool matrix

| Category | TypeScript/JavaScript | Go | Python |
| --- | --- | --- | --- |
| Built-in lint | ESLint with `@eslint/js`, `typescript-eslint`, import ordering, `eslint-plugin-security`, and strict TypeScript rules | `golangci-lint` with `errcheck`, `err113`, `gocognit`, `exhaustive`, `gosec`, `govet`, `unused`, `revive`, `staticcheck`, `funlen`, and global/init checks | Ruff rule sets: `E`, `W`, `F`, `I`, `N`, `UP`, `BLE`, `S`, `C90`, `SIM`, `PIE`, `PT`, `PTH`, `RUF`, and `D` |
| Custom lint | Local ESLint plugin under `tools/lint-rules/` | `go vet -vettool=tools/go-analyzers/bin/anvil-lint` | Local Flake8 plugin selected as `ANV` |
| Format | Prettier | `gofmt` for `make format`; `gofmt` and `goimports` via `make fix` | Ruff format |
| Type check | `tsc --noEmit` | `go vet` and `staticcheck` | `mypy` in strict mode |
| Test | Vitest | `go test` | `pytest` |
| Coverage | Vitest coverage with the v8 provider | `go test -coverprofile` with 80% line coverage enforcement | `pytest-cov` with 80% coverage enforcement |
| Dead code | Knip | `deadcode` | Vulture |
| CRAP score | `tools/crap-score.ts` | `tools/go-analyzers/bin/crap-report` | `pytest-crap` |
| Dependency audit | `bun audit --audit-level high` or the detected package manager's audit command | `govulncheck` | `pip-audit` |
| Mutation | StrykerJS | `go-mutesting` | `mutmut` |
| Secret scan | `gitleaks` | `gitleaks` | `gitleaks` |

## Validation tiers

| Tier | Command surface | Signals | Agent expectation |
| --- | --- | --- | --- |
| Fast local loop | `make lint`, `make format`, `make typecheck`, `make security` | Lint rules, formatting, type checks, and secret scanning. | Run the narrowest relevant target first while iterating. |
| Handoff gate | `make check` | Fast local checks plus tests, coverage, dead-code detection, CRAP scoring, and dependency audit. | Run `make check` before handoff. |
| Final quality boundary | `make quality` | `make check` plus mutation testing. | Run `make quality` at the final quality boundary when mutation evidence matters. |
| Automated safety net | pre-commit and pre-push hooks | The same target families, triggered by Git operations. | Do not wait for hooks as the first signal; use them as the backstop. |

Anvil does not own deployment infrastructure. The generated `make check` target is CI-ready, but the deployment system remains a project decision.

## Custom lint rule families

Anvil deploys custom rules where ecosystem tools do not already cover the agent-specific failure mode. The names differ by language plugin, but the intent is consistent.

### Anti-slop and error-handling pressure

| Rule intent | TypeScript/JavaScript | Go analyzer | Python code |
| --- | --- | --- | --- |
| Catch handlers that only log and continue | `no-log-and-continue` | `nologcontinue` | `ANV001` |
| Error paths that obscure or discard the caught error | `no-error-obscuring` | `noerrorobscuring` | `ANV002` |
| Vague placeholder comments without actionable context | `no-placeholder-comments` | `noplaceholder` | `ANV003` |
| Pass-through wrappers with identical arguments | `no-pass-through-wrapper` | `nopassthrough` | `ANV004` |
| Log and throw/return on the same error path | `no-log-and-throw` | `nologthrow` | `ANV005` |
| Unstructured logging or formatted logger messages | `require-structured-logging` | `structuredlog` | `ANV006` |
| Source files without corresponding tests | `require-test-files` | `requiretests` | `ANV007` |
| Empty catch/except handlers with no intentional handling | `no-silent-error-swallow` | `nosilenterrorswallow` | `ANV009` |
| Redundant async wrappers | `no-async-noise` | Not applicable | Not applicable |

These rules exist because agents often produce plausible-looking code that hides failure modes: broad catches, default returns, "temporary" comments, wrappers that add no behavior, or logs that make errors look handled without actually handling them.

### Structural pressure

| Rule intent | TypeScript/JavaScript | Go analyzer | Python code |
| --- | --- | --- | --- |
| File length limits | ESLint `max-lines` | `filelength` | `ANV101` |
| Function length limits | ESLint `max-lines-per-function` | `funlen` from `golangci-lint` | `ANV102` |
| Exported types live in `types.*` | `types-file-organization` | Seed convention only | `ANV103` |
| Exported errors live in `errors.*` | `errors-file-organization` | Seed convention only | `ANV104` |
| Exported constants live in `constants.*` | `constants-file-organization` | Seed convention only | `ANV105` |
| Exported enums live in `enums.*` | `enums-file-organization` | Seed convention only | `ANV106` |
| Single-export filenames match the export | `filename-match-export` | Not applicable | `ANV107` |
| Exported function values use declarations | `no-exported-function-expressions` | `noexportedfunctionexpressions` | `ANV108` |
| Dense barrel files | `no-barrel-density` | Not applicable | Not applicable |
| Over-fragmented directories | `no-over-fragmentation` | Not applicable | Not applicable |

Structural rules keep a repository navigable as an agent adds files. They make exported API surface predictable, stop sprawling files, and also stop the opposite failure mode: many tiny files that hide simple behavior behind unnecessary indirection.

### Test-quality pressure

| Rule intent | TypeScript/JavaScript | Go analyzer | Python code |
| --- | --- | --- | --- |
| Empty tests | `no-empty-tests` | `noemptytest` | `ANV201` |
| Tautological assertions | `no-tautological-assertions` | `notautological` | `ANV202` |
| Disabled tests without a reason | `no-disabled-tests-without-reason` | `nodisabledtest` | `ANV203` |
| Error-handling source without error-path tests | `require-error-path-tests` | `requireerrortest` | `ANV204` |
| Snapshot-only tests | `no-snapshot-only-tests` | Not applicable | Not applicable |

These rules force tests to be evidence, not decoration. An agent should not create an empty test, assert a constant, skip a test without explaining why, or add error handling without proving the error path.

## How an agent should operate

The human-facing docs explain the model; generated `AGENTS.md` owns the repo-local instruction contract. Inside an Anvil-generated project, expect an agent to use this loop:

1. **Read the generated README and AGENTS.md.** Identify the language, setup command, validation targets, and seed/reference code path before editing.
2. **Use the Nix shell when tools are missing.** Prefer `nix develop path:. --command make check` so required tools come from `flake.nix`.
3. **Run the narrowest relevant target first.** Use `make lint`, `make typecheck`, `make test`, or the specific failing target while iterating.
4. **Fix the first failing target.** Do not stack speculative fixes across unrelated failures. Fix the root cause, then rerun that target.
5. **Run make check before handoff.** This is the standard local contract for review, push, and CI-style validation.
6. **Run make quality at the final quality boundary.** Mutation testing is intentionally slower and belongs at delivery boundaries.
7. **Report evidence.** Summarize changed files, commands run, failures fixed, remaining risks, and any human decisions required.

When validation fails, the failure is not noise; it is Anvil's backpressure doing its job. The agent should shrink the loop, read the tool output, fix the source of the failure, and prove the fix with fresh command output.
