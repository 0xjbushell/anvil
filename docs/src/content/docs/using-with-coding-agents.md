---
title: Using with Coding Agents
description: How Anvil supports agent-assisted project adoption.
---

Anvil is built for repositories where humans and coding agents both contribute. The docs explain the model, but the operational instructions are intentionally split across smaller agent-facing artifacts so a coding agent gets the right amount of context at the right time.

The core idea is backpressure. A prompt can ask an agent to "write clean code," but a repository has to enforce what clean means. Anvil gives the agent durable local signals: generated validation commands, `AGENTS.md`, `.anvil.lock` provenance, and seed/reference code to mimic.

Human docs explain the model. Agent-facing artifacts own the step-by-step protocol:

- The [bootstrap prompt](/anvil/start.md) is for first adoption. It tells an agent how to select Anvil, verify it, and decide whether to install the skill.
- The [Anvil skill](/anvil/skills/anvil/SKILL.md) is for ongoing lifecycle work after bootstrap.
- Generated `AGENTS.md` is repo-local coding guidance. It tells agents how to work inside the scaffolded project, not how to install Anvil globally.

## What changes for an agent

Before Anvil, an agent often relies on natural-language preferences, whatever code it happens to inspect, and a final test run. After Anvil, the repository gives it a repeatable loop: read local conventions, make a bounded change, run the relevant local gate, fix the first failing signal, and report evidence.

That loop helps with the common failure modes of agent-authored code: broad catch blocks, placeholder comments, pass-through wrappers, unstructured logging, missing error-path tests, snapshot-only tests, oversized files, over-fragmented directories, unused code, and dependency risk.

## Artifact boundaries

The boundaries matter because duplicated instructions drift. `/start.md` stays short enough for first adoption. The skill owns lifecycle operations. Generated `AGENTS.md` owns repo-local coding expectations. Human docs give the explanation and examples.

## Portable Markdown skill

The published skill is plain Markdown with frontmatter:

```text
https://0xjbushell.github.io/anvil/skills/anvil/SKILL.md
```

This portable Markdown skill is the durable lifecycle protocol for Anvil operations.

Use your coding harness's documented skill import flow when it supports Markdown skills. If your harness cannot install skills, follow the hosted Markdown instructions as the reusable protocol by attaching, saving, or pasting that file into the harness's persistent instruction mechanism.

The page is not the lifecycle protocol. Use this page to understand the boundary. Copy the bootstrap prompt when you want an agent to perform adoption, then let the prompt or skill carry the operational details.
