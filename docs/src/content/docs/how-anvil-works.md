---
title: How Anvil Works
description: The generated files and validation model at a glance.
---

Anvil writes ordinary project files directly into conventional locations rather than hiding them in a managed directory. Generated files are tracked in `.anvil.lock`, so future `anvil init` runs can distinguish create, update, and no-op changes.

The generated Makefile and hooks organize validation into fast local feedback, pre-push checks, and an on-demand mutation quality gate.

## What Anvil generates

- `Makefile` targets such as `lint`, `format`, `typecheck`, `security`, `test`, `coverage`, `deadcode`, `crap`, `audit`, `mutate`, `check`, `quality`, and `fix`.
- `AGENTS.md` with concise repo-local instructions for coding agents.
- `.anvil.lock` with generated-file provenance and toolchain versions.
- Language-specific lint rules, test quality checks, dependency audit wiring, and seed/reference code.

Anvil does not generate deployment CI for user projects. The generated `make check` target is CI-ready, but choosing GitHub Actions, Azure Pipelines, or another deployment system remains a project decision.
