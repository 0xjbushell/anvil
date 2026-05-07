---
title: Python
description: Anvil's Python scaffold conventions.
---

The Python scaffold uses uv, Ruff, a local Flake8 plugin for Anvil rules, mypy, pytest coverage, dependency audit, dead-code checks, CRAP scoring, and mutation testing.

```bash
uv pip install -e ".[dev]"
make check
```

Useful generated targets include `make lint`, `make typecheck`, `make test`, `make coverage`, `make audit`, `make check`, and `make quality`.
