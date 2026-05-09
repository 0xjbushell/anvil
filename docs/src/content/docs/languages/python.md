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

## What gets wired in

Anvil adds Ruff rules, a local editable Flake8 plugin under `tools/flake8-plugin/`, mypy strict type checking, pytest coverage, Vulture dead-code checks, pip-audit, mutmut, gitleaks scanning, and a generated Nix shell with Python and uv.

The Python checks focus on maintainability pressure for agent-authored code: explicit error handling, structured logging, meaningful tests, file/function size limits, exported type/error/constant organization, and dependency risk.

## Seed/reference code

Greenfield projects receive `src/seed/` and `tests/` examples that model package structure, typed errors, constants, enums, and tests. Existing projects skip seed code when Python source already exists.
