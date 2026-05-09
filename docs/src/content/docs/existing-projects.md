---
title: Existing Projects
description: Adopt Anvil safely in repositories that already contain code.
---

Existing repositories are where Anvil's safety model matters most. The goal is to add a local feedback loop without flattening project history, overwriting intentional files, or making a coding agent guess about conflicts.

Start with a clean understanding of the working tree and preview changes before writing:

```bash
anvil init --lang typescript --dry-run
```

Anvil detects existing application code and skips seed generation when appropriate. It renders the scaffold into an in-memory FsTree first, so dry-run output can classify what would be created, updated, or left unchanged without touching disk.

## Recommended flow

1. Check the working tree and preserve unrelated changes.
2. Pick exactly one language flag: `typescript`, `golang`, or `python`.
3. Run `anvil init --lang <language> --dry-run`.
4. Review the planned file creates and updates.
5. Run `anvil init --lang <language>` only after the preview is acceptable.
6. Install generated dependencies and run `make check`.

## Conflict behavior

Interactive runs ask before applying updates to files that differ from the generated output. Non-interactive runs are deliberately stricter: conflicts produce a report, exit non-zero, and write nothing. That makes automation safe because a coding agent can show the conflict report instead of silently choosing for you.

If a non-interactive run reports conflicts, edit, move, or accept the conflicting files intentionally and rerun Anvil. Do not treat conflicts as success.

## After adoption

Read the generated README and `AGENTS.md`, install the generated dependencies, and run `make check`. Expect the first validation loop to expose real work in older repositories: missing tests, weak error handling, unused code, dependency audit findings, or source organization drift. That friction is the point. Anvil turns hidden quality debt into visible backpressure that can be fixed incrementally.
