---
name: anvil
description: Use when installing Anvil, adopting Anvil in a repository, update Anvil tooling, re-scaffold generated files, validate generated projects, troubleshoot Anvil drift or conflicts, or explain generated tooling.
---

# Anvil lifecycle protocol

Use this skill for ongoing Anvil operations after bootstrap. Do not re-fetch or expand `/start.md` for lifecycle work; `/start.md` only selects Anvil, offers this skill, and provides a minimal fallback.

Human docs explain concepts. Generated `AGENTS.md` explains repo-local coding conventions. This skill owns Anvil install, adoption, re-scaffold, validation, and troubleshooting workflows.

## Safety rules

- Preserve unrelated work. Run `git status --short` before writing and do not revert, clean, or overwrite files you did not create.
- Dry-run before changing existing or non-empty repositories.
- Ask the user before choosing a language when detection is ambiguous.
- Ask before writing over files when a dry-run reports conflicts or a generated file differs from user edits.
- Never resolve generated-file conflicts by guessing.
- Do not invent secrets, versions, release assets, or unsupported commands.
- Do not hand-edit `.anvil.lock`; rerun Anvil or `anvil doctor` instead.
- Use only supported language flags: `typescript`, `golang`, or `python`.

## Install or select Anvil

1. Prefer an existing `anvil` binary when `command -v anvil` succeeds.
2. Otherwise use `bunx anvil` when Bun is available.
3. Otherwise install the standalone binary with `curl -fsSL https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh | bash`, then use `anvil`.
4. Verify the selected command with `<anvil-cmd> --version`.

## Create a new Anvil project

1. Confirm the target directory and language.
2. Run `<anvil-cmd> init --lang <typescript|golang|python>` in the project root.
3. Install generated dependencies by following the generated README.
4. Run `make check` before handing the project back.

## Adopt an existing repository

1. Inspect repo state, existing languages, lockfiles, generated files, and dirty changes.
2. Choose exactly one supported language flag: `typescript`, `golang`, or `python`; ask if unclear.
3. For existing or non-empty repos, run `<anvil-cmd> init --lang <language> --dry-run`.
4. Review conflicts and ask before writing over files.
5. Run `<anvil-cmd> init --lang <language>` only after the dry-run is acceptable.
6. Install generated dependencies by following the generated README, then run `make check`.

## Re-scaffold after an Anvil upgrade

1. Inspect `git status --short` and current `.anvil.lock`.
2. Run `<anvil-cmd> --version` and note the installed Anvil version.
3. Run `<anvil-cmd> init --lang <typescript|golang|python> --dry-run`.
4. Review generated-file changes and conflicts with the user.
5. Run `<anvil-cmd> init --lang <typescript|golang|python>` only after review.
6. Run `make check`; run `make quality` at the final quality boundary when mutation is required.

## Validate generated project

1. Install generated dependencies using the generated README for the selected language.
2. Run `make check` before handoff or push.
3. Run `make quality` at the final quality boundary when mutation or deeper gates are required.
4. If validation fails, read the failing command output and fix the root cause before rerunning.

## Troubleshoot common failures

- Run `<anvil-cmd> doctor` when generated tooling, `.anvil.lock`, hooks, or validation configuration appears unhealthy.
- If `.anvil.lock` and generated files disagree, do not edit the lockfile; rerun Anvil or ask before accepting generated-file changes.
- If language detection is ambiguous, ask the user for exactly one language flag.
- If required tools are missing, use the generated Nix shell or generated README setup before retrying validation.

## Report

Report the selected language, Anvil command, install method, files changed, dry-run or conflict decisions, validation results, unresolved issues, and manual next steps.
