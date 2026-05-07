---
title: Existing Projects
description: Adopt Anvil safely in repositories that already contain code.
---

For an existing repository, start with a clean understanding of the working tree and preview changes before writing:

```bash
anvil init --lang typescript --dry-run
```

Anvil detects existing application code and skips seed generation when appropriate. In non-interactive mode, conflicts are reported with no files written so a human or agent can decide how to proceed.

## Recommended flow

1. Check the working tree and preserve unrelated changes.
2. Pick exactly one language flag: `typescript`, `golang`, or `python`.
3. Run `anvil init --lang <language> --dry-run`.
4. Review the planned file creates and updates.
5. Run `anvil init --lang <language>` only after the preview is acceptable.
6. Install generated dependencies and run `make check`.

If a non-interactive run reports conflicts, edit or remove the conflicting files intentionally and rerun Anvil. Do not treat conflicts as success.
