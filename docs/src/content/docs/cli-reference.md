---
title: CLI Reference
description: Current Anvil commands and flags.
---

Anvil v1 operates on the current working directory. There is no `--target-dir` flag; run Anvil from the repository or project directory you want to scaffold.

| Command | Purpose |
| --- | --- |
| `anvil init --lang <typescript|golang|python>` | Scaffold or re-scaffold project tooling. |
| `anvil init --dry-run --lang <language>` | Preview generated changes without writing. |
| `anvil init --non-interactive --lang <language>` | Run without prompts; explicit opt-in only. Conflicts exit non-zero without writing. |
| `anvil doctor` | Check generated tooling health and apply safe fixes. |
| `anvil --version` | Print the installed Anvil version. |
| `anvil -V` | Commander short form for `--version`. |

## `init`

`init` requires `--lang` and accepts exactly `typescript`, `golang`, or `python`.

Use `--dry-run` before adopting an existing repository to preview creates and updates without writing to disk. Use `--non-interactive` only when you intentionally want headless behavior; if conflicts are found, Anvil reports them and exits without writing any files.

## `doctor`

`doctor` verifies generated lint and quality configuration. It applies non-destructive fixes and reports issues that need manual review.

## Exit codes

| Command | Code | Meaning |
| --- | --- | --- |
| `anvil init` | `0` | Scaffold succeeded, including no-op or skipped files. |
| `anvil init` | `1` | Scaffold failed, including conflicts in non-interactive mode. |
| `anvil init --dry-run` | `0` | Preview printed without writing. |
| `anvil doctor` | `0` | Checks passed, possibly after safe fixes. |
| `anvil doctor` | `1` | Unresolved generated-tooling issues remain. |
| `anvil --version` | `0` | Version printed. |
