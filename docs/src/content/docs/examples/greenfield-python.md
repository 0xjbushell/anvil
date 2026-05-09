---
title: Greenfield Python
description: Start a new Python project with Anvil.
---

Use this flow for a Python project that should start with uv, Ruff, a local Flake8 plugin, mypy, pytest coverage, dependency audit, dead-code checks, CRAP scoring, and mutation testing.

```bash
mkdir my-service
cd my-service
anvil init --lang python
uv pip install -e ".[dev]"
make check
make quality
```

The generated README and `AGENTS.md` explain the local loop. `src/seed/` and `tests/` show the conventions to follow before the first feature is added.
