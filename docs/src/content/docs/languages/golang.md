---
title: Go
description: Anvil's Go scaffold conventions.
---

The Go scaffold uses Go's standard test tooling, golangci-lint, custom Anvil analyzers, vulnerability checks, coverage, dead-code checks, CRAP scoring, and mutation testing.

```bash
go mod tidy
make check
```

Useful generated targets include `make lint`, `make typecheck`, `make test`, `make coverage`, `make audit`, `make check`, and `make quality`.
