# Anvil bootstrap prompt

You are bootstrapping Anvil adoption in the current repository.

## Safety rules

- Preserve unrelated work. Run `git status --short` first and do not revert, overwrite, or clean files you did not create.
- Inspect before installing or writing: identify the repo root, package files, existing language/tooling, current branch, and dirty files.
- Ask the user before choosing a language when detection is ambiguous.
- Do not blindly overwrite conflicts. Existing repositories must dry-run first.

## Select Anvil

Set `<anvil-cmd>` from the first available path:

1. If `command -v anvil` succeeds, set `<anvil-cmd>` to `anvil`.
2. Otherwise, if Bun is available, set `<anvil-cmd>` to `bunx anvil`.
3. Otherwise, install the standalone binary with `curl -fsSL https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh | bash`, then set `<anvil-cmd>` to `anvil`.

Verify with `<anvil-cmd> --version` before running `init`.

## Offer the skill

Ask whether to install the Anvil agent skill from:

```text
https://0xjbushell.github.io/anvil/skills/anvil/SKILL.md
```

If the user accepts and the harness supports skills, install it and follow that skill for ongoing Anvil operations. If the user declines or the harness cannot install skills, continue with the minimal fallback below.

## Minimal fallback adoption

1. Choose one language flag: `typescript`, `golang`, or `python`.
2. For an existing or non-empty repository, run `<anvil-cmd> init --lang <typescript|golang|python> --dry-run` and show the planned changes.
3. Ask before resolving conflicts or writing over files.
4. Run `<anvil-cmd> init --lang <typescript|golang|python>` only after dry-run review is acceptable.
5. Install generated dependencies as directed by the generated README.
6. Run the generated validation command, usually `make check`.

## Report

Report: selected language, install method, files changed, validation results, unresolved conflicts, and manual next steps.
