---
title: How Anvil Works
description: Anvil's scaffold architecture, backpressure model, and feedback loop.
---

Anvil is a local development-environment scaffolder for agentic engineering. Its direct scaffold model writes ordinary project files into conventional locations, then uses `.anvil.lock` to remember which files it generated and which toolchain versions were selected. The result is a project that looks hand-configured, but has enough provenance for safe re-scaffold decisions.

The product idea is simple: coding agents need backpressure. Without visible local feedback, an agent can keep generating code after the first wrong assumption. Anvil puts fast, blocking signals inside the repository so the local feedback loop catches drift while the change is still small.

<div class="anvil-system-map" aria-label="Anvil scaffold architecture map">
  <article>
    <span>Input</span>
    <strong><code>anvil init</code></strong>
    <p>Runs in the current working directory with one supported language flag: <code>typescript</code>, <code>golang</code>, or <code>python</code>.</p>
  </article>
  <article>
    <span>Detection</span>
    <strong>Existing project scan</strong>
    <p>Detects application code, package manager hints, source directories, and prior <code>.anvil.lock</code> context before rendering.</p>
  </article>
  <article>
    <span>Render</span>
    <strong>Manifest + templates</strong>
    <p>The language manifest selects static assets and EJS templates for Makefiles, lint rules, Nix shells, README, and <code>AGENTS.md</code>.</p>
  </article>
  <article>
    <span>Stage</span>
    <strong>FsTree</strong>
    <p>Renders into memory first, classifies create/update/unchanged changes, powers dry-run output, and avoids writing during conflict reports.</p>
  </article>
  <article>
    <span>Output</span>
    <strong>Generated repo contract</strong>
    <p>Writes ordinary files plus <code>.anvil.lock</code>, then the generated local feedback loop becomes the interface for humans and agents.</p>
  </article>
</div>

## What Anvil generates

- `Makefile` targets such as `lint`, `format`, `typecheck`, `security`, `test`, `coverage`, `deadcode`, `crap`, `audit`, `mutate`, `check`, `quality`, and `fix`.
- `AGENTS.md` with concise repo-local instructions for coding agents.
- `.anvil.lock` with generated-file provenance and toolchain versions.
- Language-specific lint rules, test quality checks, dependency audit wiring, Nix development shells, and seed/reference code.

For the tool-by-tool breakdown, see [Development Environment](/anvil/development-environment/).

<div class="anvil-architecture-stage" aria-label="Generated project surfaces">
  <article>
    <span>Guide</span>
    <strong><code>AGENTS.md</code></strong>
    <p>Repo-local agent instructions explain where to look, which commands to run, and how to treat generated conventions.</p>
  </article>
  <article>
    <span>Prove</span>
    <strong><code>Makefile</code> gates</strong>
    <p>One command vocabulary works across TypeScript/JavaScript, Go, and Python, even though the underlying tools differ.</p>
  </article>
  <article>
    <span>Remember</span>
    <strong><code>.anvil.lock</code></strong>
    <p>Stores version, toolchain, generated-file checksums, and scaffold context so future runs can classify changes safely.</p>
  </article>
  <article>
    <span>Model</span>
    <strong>Seed/reference code</strong>
    <p>Greenfield projects get real source and tests that demonstrate structure, errors, constants, enums, and logging patterns.</p>
  </article>
</div>

## The feedback loop

Anvil's generated workflow is intentionally local-first. The agent does not wait for a remote build to discover that its assumptions were wrong. It gets pressure from the repository while it is still editing.

<div class="anvil-feedback-loop" aria-label="Agentic engineering feedback loop">
  <article>
    <span>1</span>
    <strong>Read the local contract</strong>
    <p>The agent starts with README, <code>AGENTS.md</code>, <code>.anvil.lock</code>, and seed/reference code.</p>
  </article>
  <article>
    <span>2</span>
    <strong>Make a small change</strong>
    <p>The implementation follows the visible project shape instead of inventing conventions from the prompt alone.</p>
  </article>
  <article>
    <span>3</span>
    <strong>Run targeted feedback</strong>
    <p><code>make lint</code>, <code>make typecheck</code>, or the failing target gives a narrow correction signal.</p>
  </article>
  <article>
    <span>4</span>
    <strong>Run the handoff gate</strong>
    <p><code>make check</code> proves the normal local quality bar before review or push.</p>
  </article>
  <article>
    <span>5</span>
    <strong>Escalate when needed</strong>
    <p><code>make quality</code> adds mutation testing for final quality boundaries.</p>
  </article>
  <article>
    <span>6</span>
    <strong>Report evidence</strong>
    <p>The agent reports changed files, validation output, unresolved risks, and the next human decision.</p>
  </article>
</div>

## Backpressure by design

Backpressure is the product philosophy behind Anvil. It means quality signals are close enough to the agent that they can interrupt the work, force a smaller loop, and keep humans from becoming the first line of defense.

<div class="anvil-pressure-grid" aria-label="Backpressure comparison">
  <article>
    <span>Without Anvil</span>
    <strong>Soft preferences stay in the prompt.</strong>
    <p>The agent may remember some conventions, miss others, and continue building on top of weak tests, vague TODOs, broad error handling, or unstructured logging until a human reviewer notices.</p>
  </article>
  <article>
    <span>With Anvil</span>
    <strong>Preferences become executable pressure.</strong>
    <p>Anti-slop rules, structure checks, test-quality rules, dependency audits, CRAP scoring, and mutation checks reject drift locally and give the agent concrete fixes to make.</p>
  </article>
</div>

## Validation tiers

<div class="anvil-tier-table" aria-label="Generated validation tiers">
  <table>
    <thead>
      <tr>
        <th>Tier</th>
        <th>When it runs</th>
        <th>Signals</th>
        <th>Why it matters for agents</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Fast local</strong></td>
        <td>During development</td>
        <td><code>lint</code>, <code>format</code>, <code>typecheck</code>, <code>security</code></td>
        <td>Stops style, type, secret, and obvious anti-slop issues before they spread.</td>
      </tr>
      <tr>
        <td><strong>Handoff</strong></td>
        <td>Before review or push</td>
        <td><code>test</code>, <code>coverage</code>, <code>deadcode</code>, <code>crap</code>, <code>audit</code></td>
        <td>Checks behavior, maintainability risk, unused code, and vulnerable dependencies.</td>
      </tr>
      <tr>
        <td><strong>Final quality</strong></td>
        <td>At delivery boundaries</td>
        <td><code>make quality</code> and mutation testing</td>
        <td>Tests whether the test suite can detect meaningful code changes.</td>
      </tr>
      <tr>
        <td><strong>Recovery</strong></td>
        <td>When generated tooling drifts</td>
        <td><code>anvil doctor</code></td>
        <td>Applies safe fixes and reports problems that require a human decision.</td>
      </tr>
    </tbody>
  </table>
</div>

## Existing-project safety

For existing repositories, Anvil's safest path is preview-first. `anvil init --dry-run` renders the scaffold into FsTree and prints the planned creates and updates without writing. Interactive runs ask before overwriting changed files. `--non-interactive` is explicit opt-in; when conflicts appear, it reports them and writes nothing.

That behavior is especially important for agent-assisted adoption: a coding agent can run the preview, show the planned changes, and stop for a human decision before touching ambiguous files.

## What Anvil intentionally does not own

Anvil focuses on the development feedback loop. It does not hide generated files in a managed `.anvil/` directory, does not require an `anvil update` command in v1, and does not ship deployment CI for user projects. The generated `make check` target is CI-ready, but choosing GitHub Actions, Azure Pipelines, GitLab, Jenkins, or another deployment system remains a project decision.
