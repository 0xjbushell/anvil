# AGENTS.md

## Project shape
anvil is a Bun + TypeScript scaffolder for agentic engineering projects; it generates and re-scaffolds project tooling while keeping source, fixtures, and specs close to the implementation.

## Inner loop
- After every change, run `bun agent:check`.
- Before handoff or push, run `bun fixtures`.
- Run `bun mutation` once at the final quality/delivery boundary, or rely on CI for PR verification.
- Do not run mutation during every iteration or from pre-push.
- To explore manually, run `bun dev <scenario>`, then cd into `.sandbox/scratch` and inspect the generated tree/output.
- On regression, read the failed scenario YAML and input under `tests/fixtures/`, reproduce in the sandbox, fix the cause, and rerun.

## Reference implementations
Before implementing a subsystem, read [D-69](specs/decisions/anvil-decisions.md#d-69-oss-reference-implementations-as-agent-context) for the reference registry and source of truth; match reference idioms unless an anvil decision explicitly overrides them.

## Decision discipline
`specs/decisions/anvil-decisions.md` is the source of truth for architecture and tradeoffs; when changing related code, cite D-NN in notes, tests, or comments where the link clarifies intent.

## Where things live
- `src/`: CLI, scaffold engine, dev harness, and implementation code.
- `src/templates/`: current static template skeleton (not root `templates/`).
- `tests/fixtures/`: sandbox inputs and scenario YAML for `bun dev`, `bun fixtures`, and `bun agent:check`.
- `specs/`: project requirements, architecture, and decisions.
- `.tix/`: ticket state; use the tix CLI rather than hand-editing files.
