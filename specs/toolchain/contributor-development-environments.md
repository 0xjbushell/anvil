# Contributor Development Environments

## Traceability

- **Shared Key**: `contributor-development-environments`
- **Spec Path**: `specs/toolchain/contributor-development-environments.md`
- **Requirement Refs**: `DEV-01` through `DEV-06`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-71, D-72)

## Problem Statement

Anvil validates a scaffolder that emits full development environments for TypeScript, Go, and Python. That validation is not credible if it depends on whatever tools happen to be installed on a contributor's machine. Missing tools previously caused e2e and parity tests to skip, which made local and CI signals weaker than the generated projects' own `make check` contracts.

Contributors should not assemble validation environments manually. The repository must provide automatic, idempotent entrypoints that install or enter the required environment before validation runs.

## Scope

### In Scope

- Repo-level Nix development environment for Anvil contributors.
- Full release-validation Nix environment for the entire supported-language toolchain.
- Wrapper commands or package scripts that enter the correct environment before running validation.
- Hard-fail behavior when required tools are unavailable.
- Purpose-built Nix development environments generated into TypeScript, Go, and Python projects.
- Strict generated Makefiles that fail when required tools are missing.

### Out of Scope

- Requiring contributors to install global tools by hand.
- Generating CI workflows for user projects.
- Supporting non-Nix contributor setup as the authoritative validation path.
- Installing tools unrelated to the selected generated language.

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Required tools | Hard failure, no skips | `[user]` D-71 |
| Environment manager | Nix flake outputs are canonical for Anvil development and validation | `[user]` D-72 |
| Entry points | Contributors run wrapper/package commands, not bespoke host setup | `[user]` D-72 |
| Generated environments | Each generated language project gets a purpose-built Nix environment | `[user]` D-72 |
| Makefile behavior | Generated `make check` never silently omits required targets | `[user]` D-71 |

## Architecture

### Component Overview

- `flake.nix` defines Anvil repository environments:
  - `default`: normal contributor development.
  - `release`: full release-validation toolchain.
  - `typescript-e2e`: TypeScript generated-project e2e environment.
  - `golang-e2e`: Go generated-project e2e environment.
  - `python-e2e`: Python generated-project e2e environment.
- Wrapper commands call Nix consistently so local and CI validation use the same definitions.
- Generated project templates include language-specific Nix files that match the generated Makefile.

### Data / Control Flow

1. A contributor checks out Anvil.
2. They run the documented validation command.
3. The wrapper enters the correct Nix environment.
4. Validation runs with required tools on `PATH`.
5. If the environment cannot provide a required tool, validation fails before any supported-language check can be skipped.

### Integration Points

- `package.json` scripts for contributor commands.
- `AGENTS.md` inner-loop guidance.
- Git hooks for local safety nets.
- CI workflows for PR and release validation.
- Language scaffold templates for generated Nix environments.

### Key Interfaces

```sh
nix develop
nix develop .#release
nix develop .#typescript-e2e
nix develop .#golang-e2e
nix develop .#python-e2e
```

Wrapper names are implementation details, but they must be documented and idempotent.

## What Changes

### New Artifacts

- Repo-level `flake.nix`.
- Wrapper scripts or package scripts for validation entrypoints.
- Generated TypeScript Nix environment template.
- Generated Go Nix environment template.
- Generated Python Nix environment template.

### Updated Artifacts

- Top-level `AGENTS.md` documents the Nix-backed inner loop.
- `README.md` documents contributor setup.
- Language manifests include generated Nix files.
- E2E tests assert generated Nix files are present and language-specific.

### Workflow Changes

- Contributors no longer install `uv`, `gitleaks`, `govulncheck`, `golangci-lint`, or similar tools manually.
- Missing required tools fail validation instead of causing skips.
- CI uses the same Nix entrypoints as local development.

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Nix adds onboarding friction | Medium | Medium | Provide one-command wrappers and clear README guidance |
| Tool package unavailable in pinned nixpkgs | Medium | High | Pin known-good nixpkgs and add package overlays only when necessary |
| Native deps such as `node-pty` fail to build | Medium | High | Include compiler/build tools in the repo env and validate from a clean checkout |
| CI and local env drift | Low | High | CI invokes the same wrapper commands used locally |
| Generated projects become too heavy | Medium | Medium | Purpose-build each language environment and avoid cross-language tools |

## Testing Strategy

- Work type: infrastructure / ci-pipeline.
- Testing approach: behavior verification and pipeline validation.

Acceptance criteria:

- **GIVEN** a clean checkout with Nix available **WHEN** a contributor runs the documented validation wrapper **THEN** the required Anvil validation tools are available without manual installation.
- **GIVEN** a required tool cannot be provided **WHEN** validation starts **THEN** validation fails with a clear environment error and does not skip supported-language tests.
- **GIVEN** a generated TypeScript project **WHEN** the user enters its Nix environment and runs `make check` **THEN** only TypeScript-relevant tools plus shared security tools are required.
- **GIVEN** a generated Go project **WHEN** the user enters its Nix environment and runs `make check` **THEN** only Go-relevant tools plus shared security tools are required.
- **GIVEN** a generated Python project **WHEN** the user enters its Nix environment and runs `make check` **THEN** only Python-relevant tools plus shared security tools are required.

## Open Questions

- Whether generated projects should use full `flake.nix` files or smaller `shell.nix` files in v1.
- Whether wrapper commands should invoke `nix develop --command ...` directly or require an already-entered shell.
