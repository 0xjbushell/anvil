---
title: Getting Started
description: Install Anvil, scaffold a project, and run the first validation loop.
---

Use Anvil when you want a project to start with the same local contract you expect a senior engineer to follow: clear conventions, fast validation, safety checks, and enough context for coding agents to correct themselves before a human reviewer has to.

Anvil is not a framework. It writes normal project files for TypeScript/JavaScript, Go, or Python, then makes the feedback loop explicit through generated Makefile targets, `AGENTS.md`, `.anvil.lock`, seed/reference code, and language-specific quality tooling.

## The shortest path

```bash
bunx anvil init --lang typescript
make check
```

Choose `typescript`, `golang`, or `python` for the language flag. For existing repositories, read [Existing Projects](/anvil/existing-projects/) before writing files so you can preview the scaffold first.

## Pick your path

**New repository:** create an empty directory, run `anvil init --lang <language>`, install the generated dependencies, and run `make check`.

**Existing repository:** start with `anvil init --lang <language> --dry-run`. Review the planned creates and updates before allowing Anvil to write files.

**Coding-agent adoption:** copy the prompt from the [Overview](/anvil/) so the agent fetches `/start.md`, verifies Anvil, and follows the Anvil skill or fallback adoption flow.

## First validation loop

After generation, install the language dependencies shown in the generated README and run:

```bash
make check
```

`make check` is the normal handoff gate. It pulls together the everyday signals: linting, formatting, type checking, security checks, tests, coverage, dead-code detection, CRAP scoring, and dependency audit where those targets apply.

When a target fails, fix the first failing cause and rerun that target before rerunning `make check`. That is Anvil's backpressure loop: the repository gives the agent or human a small correction signal, then the next loop proves the fix.

Run `make quality` at the final quality boundary when you also want mutation testing.

## What to read after init

Start with the generated README for setup commands, then read `AGENTS.md` before asking a coding agent to edit the project. If Anvil generated seed/reference code, treat it as the local example of the conventions the rest of the project should follow.
