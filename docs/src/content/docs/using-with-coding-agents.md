---
title: Using with Coding Agents
description: How Anvil supports agent-assisted project adoption.
---

Anvil gives coding agents a small set of durable conventions: generated validation commands, `AGENTS.md`, `.anvil.lock` provenance, and seed/reference code to mimic.

Human docs explain the model. Agent-facing artifacts own the step-by-step protocol:

- The [bootstrap prompt](/anvil/start.md) is for first adoption. It tells an agent how to select Anvil, verify it, and decide whether to install the skill.
- The [Anvil skill](/anvil/skills/anvil/SKILL.md) is for ongoing lifecycle work after bootstrap.
- Generated `AGENTS.md` is repo-local coding guidance. It tells agents how to work inside the scaffolded project, not how to install Anvil globally.

## Portable Markdown skill

The published skill is plain Markdown with frontmatter:

```text
https://0xjbushell.github.io/anvil/skills/anvil/SKILL.md
```

This portable Markdown skill is the durable lifecycle protocol for Anvil operations.

Use your coding harness's documented skill import flow when it supports Markdown skills. If your harness cannot install skills, follow the hosted Markdown instructions as the reusable protocol by attaching, saving, or pasting that file into the harness's persistent instruction mechanism.

The page is not the lifecycle protocol. Use this page to understand the boundary. Copy the bootstrap prompt when you want an agent to perform adoption, then let the prompt or skill carry the operational details.
