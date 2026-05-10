---
title: Greenfield Go
description: Start a new Go project with Anvil.
---

Use this flow when you want a Go repository with local analyzers, vulnerability checks, coverage, CRAP scoring, and mutation testing from the first commit.

```bash
mkdir my-service
cd my-service
anvil init --lang golang
go mod tidy
make check
make quality
```

The scaffold includes `internal/seed/`, `cmd/app/`, generated analyzers under `tools/go-analyzers/`, and a Makefile that exposes the same validation vocabulary a coding agent should use.
