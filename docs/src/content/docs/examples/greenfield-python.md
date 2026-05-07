---
title: Greenfield Python
description: Start a new Python project with Anvil.
---

```bash
mkdir my-service
cd my-service
anvil init --lang python
uv pip install -e ".[dev]"
make check
make quality
```
