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

<section class="anvil-copy-section" aria-labelledby="why-anvil">
  <p class="anvil-section-kicker">Why Anvil</p>
  <h2 id="why-anvil">A local contract for serious agent-assisted engineering.</h2>
  <p>Modern repositories have more than one kind of contributor. Humans make design calls, coding agents draft and refactor, and both need the same definition of "ready." Anvil turns that definition into ordinary files in the repository: generated Makefile targets, language-specific linting, <code>AGENTS.md</code>, <code>.anvil.lock</code> provenance, and seed/reference code when a scaffold includes it.</p>
  <p>The result is not a hidden framework. It is a visible engineering contract that makes quality feedback fast, repeatable, and understandable before code leaves a local branch.</p>

  <div class="anvil-value-grid" aria-label="Anvil value pillars">
    <article>
      <span>Shared rules</span>
      <strong>One validation loop for people and agents.</strong>
      <p><code>make check</code> becomes the common handoff gate. Agents can run the same commands humans review, then report concrete failures instead of guessing.</p>
    </article>
    <article>
      <span>Safe adoption</span>
      <strong>Preview before writing.</strong>
      <p>Existing repositories start with <code>anvil init --dry-run</code>. In automation, non-interactive runs report conflicts and write nothing, so ambiguous changes stay explicit.</p>
    </article>
    <article>
      <span>Durable conventions</span>
      <strong>Scaffolded code stays instructive.</strong>
      <p><code>AGENTS.md</code> explains repo-local expectations, <code>.anvil.lock</code> records generated ownership, and any seed/reference code demonstrates structure to follow.</p>
    </article>
  </div>
</section>

<section class="anvil-copy-section" aria-labelledby="guardrails">
  <p class="anvil-section-kicker">Guardrails Anvil wires in</p>
  <h2 id="guardrails">Quality gates that catch drift early.</h2>
  <p>Anvil generates language-specific gates for TypeScript/JavaScript, Go, and Python. The exact tools differ by language, but the feedback model is the same: fast local checks first, behavior and maintainability next, and mutation testing when you need the final quality gate.</p>

  <div class="anvil-guardrail-grid" aria-label="Generated validation tiers">
    <article>
      <span>Tier 1</span>
      <strong>Shape every change</strong>
      <p><code>lint</code>, <code>format</code>, <code>typecheck</code>, and <code>security</code> catch style drift, type errors, and gitleaks secret findings before deeper checks run.</p>
    </article>
    <article>
      <span>Tier 2</span>
      <strong>Prove behavior and maintainability</strong>
      <p><code>test</code>, <code>coverage</code>, <code>deadcode</code>, <code>crap</code>, and <code>audit</code> look for broken behavior, untested paths, unused code, CRAP risk, and vulnerable dependencies.</p>
    </article>
    <article>
      <span>Tier 3</span>
      <strong>Stress the test suite</strong>
      <p><code>mutate</code> runs mutation checks on demand. <code>make quality</code> combines <code>make check</code> with the mutation gate for final delivery confidence.</p>
    </article>
    <article>
      <span>Recovery</span>
      <strong>Diagnose generated tooling</strong>
      <p><code>anvil doctor</code> verifies generated configuration health, applies safe fixes, and reports issues that need manual review.</p>
    </article>
  </div>
</section>

<section class="anvil-copy-section" aria-labelledby="lint-rules">
  <p class="anvil-section-kicker">What the lint rules catch</p>
  <h2 id="lint-rules">The guardrails target common failure modes, not just formatting.</h2>

  <div class="anvil-rule-grid" aria-label="Anvil lint rule families">
    <article>
      <strong>Error handling and logging</strong>
      <p><code>no-log-and-continue</code>, <code>no-error-obscuring</code>, <code>no-log-and-throw</code>, <code>no-silent-error-swallow</code>, and <code>require-structured-logging</code> push failures toward explicit, inspectable handling.</p>
    </article>
    <article>
      <strong>Slop and structure</strong>
      <p><code>no-placeholder-comments</code>, <code>no-pass-through-wrapper</code>, <code>no-async-noise</code>, max file length, max function length, export organization, and <code>no-over-fragmentation</code> keep code navigable as projects grow.</p>
    </article>
    <article>
      <strong>Test quality</strong>
      <p><code>require-test-files</code>, <code>no-empty-tests</code>, <code>no-tautological-assertions</code>, <code>no-disabled-tests-without-reason</code>, <code>require-error-path-tests</code>, and snapshot-only checks keep tests meaningful.</p>
    </article>
    <article>
      <strong>Security and dependencies</strong>
      <p>Security linting, gitleaks, package audits, <code>govulncheck</code>, and <code>pip-audit</code> make secrets and vulnerable dependencies part of the same local feedback loop.</p>
    </article>
  </div>
</section>

<section class="anvil-copy-section" aria-labelledby="development-workflow">
  <p class="anvil-section-kicker">Development workflow</p>
  <h2 id="development-workflow">A tight loop from scaffold to evidence.</h2>

  <div class="anvil-flow" aria-label="Development workflow visualization">
    <article>
      <span>1</span>
      <strong>Preview or initialize</strong>
      <p>Use <code>anvil init --dry-run</code> for existing repositories, or initialize a new TypeScript/JavaScript, Go, or Python project directly.</p>
    </article>
    <article>
      <span>2</span>
      <strong>Follow generated conventions</strong>
      <p>Read the generated README, <code>AGENTS.md</code>, and any seed/reference code before changing application files.</p>
    </article>
    <article>
      <span>3</span>
      <strong>Run the handoff gate</strong>
      <p><code>make check</code> runs the normal lint, typecheck, security, test, coverage, deadcode, CRAP, and audit gates.</p>
    </article>
    <article>
      <span>4</span>
      <strong>Fix from evidence</strong>
      <p>Fix the first failing target, rerun it, then rerun <code>make check</code>. Use <code>make quality</code> when the mutation gate matters.</p>
    </article>
  </div>
</section>

<section class="anvil-copy-section" aria-labelledby="agent-loop">
  <p class="anvil-section-kicker">Agent feedback loop</p>
  <h2 id="agent-loop">Agents get a bounded protocol instead of a blank prompt.</h2>
  <p>The hosted bootstrap prompt is intentionally small. It helps an agent select Anvil, verify the install, ask before installing the Anvil skill, and hand off lifecycle work to the reusable protocol. The generated project then gives the agent local context through <code>AGENTS.md</code>, <code>.anvil.lock</code>, and the Makefile gates.</p>

  <div class="anvil-agent-loop" aria-label="Agent feedback loop visualization">
    <article>
      <span>Human intent</span>
      <strong>Ask for adoption or validation</strong>
    </article>
    <article>
      <span>Bootstrap</span>
      <strong><code>/start.md</code> selects and verifies Anvil</strong>
    </article>
    <article>
      <span>Protocol</span>
      <strong>The Anvil skill owns lifecycle work</strong>
    </article>
    <article>
      <span>Repository context</span>
      <strong><code>AGENTS.md</code> + <code>.anvil.lock</code></strong>
    </article>
    <article>
      <span>Feedback</span>
      <strong><code>make check</code> returns concrete failures</strong>
    </article>
    <article>
      <span>Report</span>
      <strong>Agent summarizes files, gates, and next steps</strong>
    </article>
  </div>
</section>

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
