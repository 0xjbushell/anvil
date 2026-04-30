# Release Validation and Distribution

## Traceability

- **Shared Key**: `release-validation-and-distribution`
- **Spec Path**: `specs/toolchain/release-validation-and-distribution.md`
- **Requirement Refs**: `REL-01` through `REL-07`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-45, D-65, D-71, D-72, D-74)

## Problem Statement

Public release requires more proof than local unit tests. Anvil must prove that its release workflow builds the assets users install, that the installer resolves those assets correctly, and that the compiled binary can scaffold projects outside the repository where source-tree assets are unavailable.

Release validation is the authoritative gate. It must use the full Nix-provisioned environment and fail on any required-tool absence or supported-language skip.

## Scope

### In Scope

- Release CI using the full Nix release environment.
- No-skip supported-language e2e and parity validation.
- Standalone binary scaffold tests from outside the repository.
- Installer URL behavior for `latest` and pinned versions.
- Release workflow asset build and upload.
- Release rehearsal or equivalent proof that installer-referenced assets exist.
- Tix/spec hygiene checks for shipped scope.

### Out of Scope

- Generating CI workflows for Anvil-created user projects.
- Publishing package-registry releases beyond the existing Bun/binary distribution decision.
- Artifact signing and checksum verification unless added by a later decision.

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Release gate | Full Nix release environment, no required-tool skips | `[user]` D-71, D-72 |
| Binary proof | Compiled binary must scaffold outside repo | `[audit]` D-74 |
| Installer latest URL | GitHub `/releases/latest/download/` endpoint | `[audit]` D-74 |
| Asset upload | Release workflow uploads every installer-referenced binary | `[audit]` D-74 |
| Tix hygiene | Release validation checks shipped deliverable state | `[audit]` |

## Architecture

### Component Overview

- Release validation workflow enters `nix develop .#release`.
- Validation runs Anvil's repo-level gates and supported-language e2e.
- Build workflow creates platform binaries from `scripts/build.ts`.
- Release workflow uploads those binaries to GitHub Releases.
- Installer downloads either latest or pinned version assets.

### Data / Control Flow

1. Release CI starts from a clean checkout.
2. It enters the full Nix release environment.
3. It runs project validation.
4. It builds binaries.
5. It installs or copies a host binary into a clean directory outside the repo.
6. It runs `anvil init` for supported languages through that binary.
7. It verifies release workflow asset names match installer expectations.

### Integration Points

- `.github/workflows/release.yml`.
- `scripts/build.ts`.
- `scripts/install.sh`.
- `tests/distribution.test.ts`.
- `tests/e2e/*.test.ts`.
- `tix status --json`.

### Key Interfaces

```sh
nix develop .#release --command bun agent:check
nix develop .#release --command bun fixtures
nix develop .#release --command bun test
nix develop .#release --command bun run build
nix develop .#release --command bun mutation
```

## What Changes

### New Artifacts

- Release validation CI job.
- Standalone binary scaffold test fixture.
- Release asset upload steps if missing from workflow.

### Updated Artifacts

- Installer URL logic.
- Distribution tests to exercise real scaffold behavior, not just `--version`.
- Release workflow to build and upload expected assets.
- Tix/spec governance checks for release.

### Workflow Changes

- Release CI is the final public-release authority.
- Passing `--version` is insufficient distribution proof.
- Supported-language e2e skips are release failures.

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Standalone binary cannot find scaffold assets | High | High | Embed assets or install assets beside binary; test outside repo |
| Release assets missing after tag | Medium | High | Workflow uploads assets and tests expected names |
| Installer latest URL points at a non-existent tag | Medium | High | Special-case `latest` endpoint and test both URL modes |
| Release CI becomes too slow | Medium | Medium | Keep fast PR CI separate, but do not relax release gate |
| Tix parent rollups stay stale | Medium | Medium | Add release hygiene check and document intentional exceptions |

## Testing Strategy

- Work type: ci-pipeline / infrastructure.
- Testing approach: behavior verification and pipeline validation.

Acceptance criteria:

- **GIVEN** release CI **WHEN** required tools are missing **THEN** the job fails before reporting supported-language success.
- **GIVEN** a compiled host binary copied outside the repository **WHEN** `anvil init --lang typescript --non-interactive` runs **THEN** scaffold assets resolve and project files are generated.
- **GIVEN** a pinned version **WHEN** the installer builds the asset URL **THEN** it uses `/releases/download/<version>/<asset>`.
- **GIVEN** `ANVIL_VERSION=latest` **WHEN** the installer builds the asset URL **THEN** it uses `/releases/latest/download/<asset>`.
- **GIVEN** a release tag **WHEN** release workflow runs **THEN** all `scripts/build.ts` binary targets are uploaded as release assets.
- **GIVEN** shipped scope **WHEN** release validation checks tix **THEN** no executable deliverables are accidentally left open.

## Open Questions

- Whether v1 embeds scaffold assets in the compiled binary or installs an asset directory beside it.
- Whether artifact checksums/signing are in scope for the first public release or follow in a later hardening pass.
