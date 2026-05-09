---
title: Anvil
description: Agent-ready project scaffolding for TypeScript/JavaScript, Go, and Python.
tableOfContents: false
---

<div class="anvil-hero" aria-label="Anvil overview">
  <div class="anvil-hero-copy">
    <p class="anvil-eyebrow">Agent-ready scaffolding</p>
    <h2>Forge projects that humans and coding agents can both trust.</h2>
    <p>Anvil writes strict project tooling for TypeScript/JavaScript, Go, and Python, records generated-file provenance in <code>.anvil.lock</code>, and gives coding agents concise repo-local guidance through <code>AGENTS.md</code>.</p>
    <div class="anvil-actions">
      <a class="anvil-button" href="/anvil/getting-started/">Start building</a>
      <a class="anvil-button anvil-button-secondary" href="/anvil/using-with-coding-agents/">Agent workflow</a>
    </div>
  </div>
  <div class="anvil-command-panel" aria-label="Anvil validation flow">
    <code>bunx anvil init --lang typescript</code>
    <div class="anvil-command-steps" aria-label="Generated project loop">
      <span>AGENTS.md</span>
      <span>.anvil.lock</span>
      <span>make check</span>
    </div>
  </div>
</div>

The published docs live at <https://0xjbushell.github.io/anvil/> and cover the human-facing path: install Anvil, initialize a project, adopt it in an existing repository, and use the generated validation loop.

<div class="anvil-signal-grid" aria-label="What Anvil gives you">
  <a class="anvil-signal-card" href="/anvil/getting-started/">
    <span class="anvil-card-index">01</span>
    <strong>Scaffold</strong>
    <span>Generate real project files that establish lasting conventions.</span>
  </a>
  <a class="anvil-signal-card" href="/anvil/how-anvil-works/">
    <span class="anvil-card-index">02</span>
    <strong>Record</strong>
    <span>Track generated-file ownership and provenance in <code>.anvil.lock</code>.</span>
  </a>
  <a class="anvil-signal-card" href="/anvil/using-with-coding-agents/">
    <span class="anvil-card-index">03</span>
    <strong>Guide</strong>
    <span>Give coding agents local instructions and a repeatable validation loop.</span>
  </a>
</div>

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
