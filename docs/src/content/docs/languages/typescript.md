---
title: TypeScript and JavaScript
description: Anvil's TypeScript/JavaScript scaffold conventions.
---

The TypeScript/JavaScript scaffold uses Bun, ESLint flat config, strict type checking for TypeScript source, coverage, dependency audit, dead-code checks, CRAP scoring, and mutation testing. It also runs the generated ESLint and test tooling across JavaScript source where those tools apply.

```bash
bun install
make check
```

Useful generated targets include `make lint`, `make typecheck`, `make test`, `make coverage`, `make audit`, `make check`, and `make quality`.

## What gets wired in

Anvil adds a local ESLint plugin under `tools/lint-rules/`, a CRAP score reporter, Vitest coverage, Knip dead-code checks, Stryker mutation testing, security linting, gitleaks scanning, and a generated Nix shell with the tools needed to run the Makefile gates.

The TypeScript rules focus on agent failure modes: vague placeholder comments, error-obscuring catches, log-and-continue blocks, pass-through wrappers, async noise, missing tests, weak test assertions, oversized files, exported type/error/constant organization, and over-fragmented directories.

## Seed/reference code

Greenfield projects receive `src/seed/` with source and tests that model the generated conventions. Existing projects skip seed code when Anvil detects application code, so adoption adds guardrails without pretending your repository is empty.
