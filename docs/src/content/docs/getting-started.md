---
title: Getting Started
description: Install Anvil, scaffold a project, and run the first validation loop.
---

Use Anvil when you want a project to start with strict local quality gates and clear conventions for both humans and coding agents.

```bash
bunx anvil init --lang typescript
make check
```

Choose `typescript`, `golang`, or `python` for the language flag. For existing repositories, read [Existing Projects](/anvil/existing-projects/) before writing files so you can preview the scaffold first.

## First validation loop

After generation, install the language dependencies shown in the generated README and run:

```bash
make check
```

`make check` is the normal pre-push gate. `make quality` adds mutation testing and is intended for the final quality boundary.
