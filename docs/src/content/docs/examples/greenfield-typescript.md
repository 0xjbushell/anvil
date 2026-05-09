---
title: Greenfield TypeScript
description: Start a new TypeScript project with Anvil.
---

Use this flow for a new service or library where Anvil can create the initial project contract.

```bash
mkdir my-service
cd my-service
bunx anvil init --lang typescript
bun install
make check
make quality
```

After the scaffold, read `AGENTS.md` and `src/seed/` before adding application code. Those files are the local examples a coding agent should follow.
