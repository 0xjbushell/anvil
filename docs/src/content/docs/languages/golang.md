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

## What gets wired in

Anvil adds golangci-lint configuration, custom `go vet -vettool` analyzers under `tools/go-analyzers/`, `govulncheck`, `deadcode`, Go coverage, CRAP reporting, Go mutation testing, gitleaks scanning, and a generated Nix shell with the required Go tooling.

The custom analyzer bundle targets agentic drift that normal formatters miss: weak error handling, placeholder comments, pass-through wrappers, missing tests, empty tests, tautological assertions, disabled tests without reasons, and structural limits such as file length.

## Seed/reference code

Greenfield projects receive `internal/seed/` plus a small `cmd/app/` entrypoint so agents have package structure, typed errors, constants, enums, structured logging, and tests to imitate. Existing projects skip seed code when Go files or `go.mod` already exist.
