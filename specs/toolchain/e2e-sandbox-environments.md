# E2E Sandbox Environments

## Traceability

- **Shared Key**: `e2e-sandbox-environments`
- **Spec Path**: `specs/toolchain/e2e-sandbox-environments.md`
- **Requirement Refs**: `E2E-01` through `E2E-07`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-68, D-71, D-72, D-73)

## Problem Statement

Anvil is a scaffolder CLI. Its e2e evidence must prove that Anvil can initialize and re-scaffold real TypeScript, Go, and Python projects in controlled development environments. Version-only fixture scenarios and host-global tool assumptions do not prove that generated projects work.

The sandbox harness must provide realistic, repeatable environments and fail when required tooling or setup is missing.

## Scope

### In Scope

- Nix-backed e2e sandbox environments per supported language.
- Fixture `setup.sh` execution before Anvil runs.
- Real greenfield, existing-code, dirty-repo, hostile, monorepo, partial-toolchain, and re-scaffold scenarios.
- Multi-step or equivalent scenario support for re-scaffold behavior.
- Required-tool hard failures in e2e.
- Test isolation for temp dirs, home dirs, caches, lockfiles, and tool state.
- `agent:check` selection that maps changes to real scenarios.

### Out of Scope

- Byte-for-byte full directory snapshots.
- Host-global e2e prerequisites as the authoritative path.
- Skipping required supported-language scenarios when Nix can provide the environment.

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Fixture setup | Execute `setup.sh` after copy and before Anvil invocation | `[user]` D-73 |
| Scenario strength | Real scaffold/re-scaffold flows; version-only scenarios only for version behavior | `[user]` D-73 |
| Environment source | Purpose-built Nix sandboxes per language | `[user]` D-72 |
| Missing required tools | Fail, never skip | `[user]` D-71 |
| Assertion style | Yeoman-style intent assertions, not full-tree snapshots | `[decision]` D-68 |

## Architecture

### Component Overview

- `tests/fixtures/inputs/` remains the committed starting-state catalog.
- `tests/fixtures/scenarios/` defines assertion-driven scenarios.
- `src/dev/harness.ts` copies input, executes setup, runs Anvil, and evaluates assertions.
- `src/dev/pty-runner.ts` drives interactive scenarios.
- Nix e2e environments provide the toolchain for each language.

### Data / Control Flow

1. The harness resolves a scenario.
2. It enters or is launched inside the scenario's language-appropriate Nix environment.
3. It copies the input directory to an isolated sandbox.
4. It runs `setup.sh` if present.
5. It invokes Anvil through args or PTY.
6. It evaluates assertion DSL expectations.
7. It preserves failing workdirs and deletes passing workdirs.

### Integration Points

- `bun dev <scenario>` for manual reproduction.
- `bun fixtures` for full fixture regression.
- `bun agent:check` for diff-selected scenarios.
- Nix e2e shells for language toolchains.
- CI jobs that run the same fixture commands.

### Key Interfaces

Fixture scenarios may declare or infer a language environment. The exact schema is implementation-defined, but it must be able to map each scenario to the correct Nix sandbox.

```yaml
name: greenfield-go
input: greenfield
args: [init, --lang, golang, --non-interactive]
expect:
  exit_code: 0
  files_exist:
    - go.mod
    - internal/seed/seed.go
    - Makefile
```

## What Changes

### New Artifacts

- Nix sandbox outputs for TypeScript, Go, and Python e2e.
- Real fixture scenarios for every supported language and critical re-scaffold path.

### Updated Artifacts

- Harness setup flow executes `setup.sh`.
- Scenario schema supports any new environment metadata required by Nix-backed runs.
- `agent:check` selection rules account for new real scenarios.
- Fixture documentation explains setup, isolation, and no-skip behavior.

### Workflow Changes

- A fixture cannot pass by proving only `anvil --version` unless version behavior is the scenario purpose.
- Dirty and hostile fixture inputs actually set up dirty and hostile states.
- E2E failure due to missing required tools is treated as an environment failure.

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Nix startup makes fixtures slower | Medium | Medium | Cache dependencies and run scenarios in parallel only when state is isolated |
| Setup scripts introduce nondeterminism | Medium | High | Require deterministic setup scripts and fail on setup stderr/exit code |
| PTY tests flap | Medium | High | Use stable prompt substrings, longer timeouts only where justified, and isolated processes |
| `agent:check` misses a scenario | Medium | High | Add tests for changed-file to scenario-selection mappings |
| Re-scaffold scenarios are hard to model | Medium | High | Add multi-step support or prebuilt fixture states with setup scripts |

## Testing Strategy

- Work type: integration-sdk / infrastructure.
- Testing approach: smoke + integration tests plus harness behavior verification.

Acceptance criteria:

- **GIVEN** a fixture input with `setup.sh` **WHEN** `bun fixtures` runs **THEN** setup executes before Anvil and setup failures fail the scenario.
- **GIVEN** committed fixture scenarios **WHEN** `bun fixtures` runs **THEN** supported-language scenarios perform real scaffold or re-scaffold behavior, not just `--version`.
- **GIVEN** a missing required tool in a language e2e environment **WHEN** e2e starts **THEN** the run fails with an environment error instead of skipping.
- **GIVEN** a core scaffold engine change **WHEN** `bun agent:check` runs **THEN** real fixture scenarios are selected.
- **GIVEN** repeated full-suite runs **WHEN** e2e executes alongside unit tests **THEN** temp dirs, caches, and lock state do not race.

## Open Questions

- Whether interactive Go and Python scenarios are required in the first remediation slice or can follow after TypeScript parity is restored.
- Whether scenario language should be explicit in YAML or derived from args and lockfile metadata.
