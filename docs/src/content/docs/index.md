---
title: Anvil
description: Agent-ready project scaffolding for TypeScript/JavaScript, Go, and Python.
---

Anvil scaffolds strict, agent-ready project tooling for TypeScript/JavaScript, Go, and Python projects. It writes real project files in conventional locations, records generated-file provenance in `.anvil.lock`, and gives coding agents concise repo-local guidance through `AGENTS.md`.

The published docs live at <https://0xjbushell.github.io/anvil/> and cover the human-facing path: install Anvil, initialize a project, adopt it in an existing repository, and use the generated validation loop.

## Start here

- [Getting Started](getting-started/) for the shortest path from install to first validation.
- [Installation](installation/) for Bun and standalone release options.
- [Existing Projects](existing-projects/) for safe dry-run adoption.
- [Using with Coding Agents](using-with-coding-agents/) for the human explanation of Anvil's agent-assisted flow.

## Agent-assisted adoption

Copy this prompt into a coding agent when you want it to install or adopt Anvil for a repository:

```text
Fetch https://0xjbushell.github.io/anvil/start.md and follow it to install Anvil, adopt it safely in this repository, and run the validation loop.
```
