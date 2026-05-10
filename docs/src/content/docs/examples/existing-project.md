---
title: Existing Project
description: Preview and adopt Anvil in a repository with code.
---

Use this flow when the repository already has application code and Anvil should add guardrails without assuming it owns the project.

```bash
git status --short
anvil init --lang typescript --dry-run
anvil init --lang typescript
make check
make quality
```

Do not overwrite unrelated work blindly. Review conflicts and rerun the scaffold after resolving them.

Expect `make check` to surface existing quality debt. That is useful signal: Anvil turns drift into a concrete list of lint, test, coverage, dead-code, CRAP, audit, or type-check work that a human or coding agent can address in smaller loops.
