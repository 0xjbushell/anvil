# Specs

Specifications for the **anvil** project — an agentic engineering project scaffolder.

## Top-Level Files

- `PROJECT.md` — project overview, core value, constraints
- `REQUIREMENTS.md` — categorized requirements (v1 / v2 / out of scope)
- `SPEC_TEMPLATE.md` — canonical template for feature specs

## Subsystem Placement Index

| Subsystem | Path | Description |
|-----------|------|-------------|
| cli | `specs/cli/` | CLI commands, scaffold engine, lockfile management |
| rules | `specs/rules/` | Custom lint rules (anti-slop, structural, test quality) |
| toolchain | `specs/toolchain/` | Quality toolchain (coverage, mutation, CRAP, dead code, security) |
| scaffold | `specs/scaffold/` | Scaffolding output (seed code, AGENTS.md, configs, git hooks) |

### Specs Index

| Spec | Subsystem | Requirements |
|------|-----------|-------------|
| `cli/scaffold-engine.md` | cli | CLI-01, CLI-03..07 |
| `rules/lint-rules.md` | rules | RULE-01..09, STRUCT-01..08, TEST-01..05 |
| `toolchain/quality-toolchain.md` | toolchain | CONFIG-01..03, QUAL-01..05, SEC-01..02, TYPE-01 |
| `scaffold/project-output.md` | scaffold | SCAF-01..04, SCAF-06..07 |

Do **not** guess placement — propose a new subsystem with rationale if none fits.

## For AI Agents

1. Check this index for correct subsystem placement.
2. Copy `SPEC_TEMPLATE.md` as the starting point for new specs.
3. Use `kebab-case` for spec filenames (e.g., `error-handling-rules.md`).
4. Update subsystem index when adding the first spec to a new subsystem.
