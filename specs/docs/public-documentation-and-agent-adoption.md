# Public Documentation and Agent-Assisted Adoption

## Traceability

- **Shared Key**: `public-docs-agent-adoption`
- **Spec Path**: `specs/docs/public-documentation-and-agent-adoption.md`
- **Requirement Refs**: `DOC-01..08`
- **Decision Refs**: `specs/decisions/anvil-decisions.md` (D-01, D-08, D-20, D-21, D-37, D-39, D-45, D-55, D-65, D-75)

## Problem Statement

Anvil has strong internal specs and release validation, but public users still lack a clear path to understand, install, adopt, and operate it. The current root README is too thin for a public OSS release: it does not explain how Anvil works, why the generated files exist, how to use it in existing repositories, or how coding agents should safely drive adoption.

Anvil also has a distinctive adoption path: users may ask a coding agent to install and apply Anvil for them. That requires concise agent-facing instructions that avoid repeated context, avoid conflicting guidance, and preserve user code. The docs system must support both human education and reliable agent execution without letting those two surfaces drift.

## Scope

### In Scope

- Astro Starlight public documentation site deployed as a static site via GitHub Pages.
- A concise root README that acts as the GitHub landing page and links to the docs site.
- Human docs for installation, quickstart, CLI reference, how Anvil works, existing-project adoption, coding-agent usage, troubleshooting, language guides, and examples.
- A hosted `/start.md` bootstrap prompt for coding agents.
- An installable Anvil agent skill as the canonical ongoing operational protocol.
- Clear boundaries between root README, human docs, `/start.md`, the installable skill, and generated `AGENTS.md`.
- Generated project README improvements that explain Anvil-generated validation gates, seed code, and first commands.
- Docs build/check wiring so documentation changes are validated before publication.

### Out of Scope

- Building a custom docs application beyond static Astro Starlight configuration.
- Versioned documentation for multiple Anvil releases.
- Search indexing that depends on hosted third-party services.
- Harness-specific automatic skill installation for every agent product. The first version documents portable install instructions and may include harness-specific examples.
- A new `anvil update` command. Lifecycle docs and skill workflows use existing `anvil init` re-scaffold behavior and `anvil doctor`.

## Design Decisions

| Decision | Choice | Source |
|----------|--------|--------|
| Docs framework | Astro Starlight static site | `[user]` D-75 |
| Hosting | GitHub Pages from `main` via workflow | `[decision]` D-75 |
| Root README role | Short landing page, not full docs | `[decision]` D-75 |
| Agent bootstrap | Hosted `/start.md` with concise first-adoption protocol | `[user]` D-75 |
| Agent skill role | Installable operational protocol for ongoing lifecycle | `[user]` D-75 |
| Non-overlap | One canonical responsibility per artifact | `[user]` D-75 |
| Existing project safety | Dry-run first, preserve unrelated changes, ask on ambiguity | `[decision]` D-08, D-39, D-75 |
| Generated project docs | Explain generated gates and seed code without implying disposability | `[decision]` D-20, D-37, D-75 |

## Architecture

### Component Overview

```text
README.md
  Concise GitHub landing page:
  - what Anvil is
  - one install/quickstart teaser
  - links to docs, releases, changelog, contributing

docs/
  Astro Starlight site:
  - astro.config.mjs
  - package.json
  - src/content/docs/
      index.md
      getting-started.md
      installation.md
      cli-reference.md
      how-anvil-works.md
      using-with-coding-agents.md
      existing-projects.md
      troubleshooting.md
      languages/
        typescript.md
        golang.md
        python.md
      examples/
        greenfield-typescript.md
        greenfield-golang.md
        greenfield-python.md
        existing-project.md
  - src/pages/start.md.ts or public/start.md
  - public/skills/anvil/SKILL.md

.github/workflows/docs.yml
  Builds and deploys the static docs site to GitHub Pages.

src/templates/<language>/README.md.ejs
  Generated project README templates explain Anvil-generated files,
  validation gates, seed code, and first local commands.
```

### Data / Control Flow

#### Human documentation flow

```text
User opens GitHub repository
  -> README explains Anvil in one screen
  -> README links to docs site
  -> Docs site guides by task:
       install -> quickstart -> language guide -> troubleshooting
```

#### Agent-assisted adoption flow

```text
User clicks "Copy Agent Prompt"
  -> prompt tells agent to fetch /start.md
  -> /start.md instructs agent to:
       inspect repo
       install/select Anvil
       verify anvil --version
       ask whether to install the Anvil skill
       if yes: install skill and follow it
       if no: run minimal safe adoption flow
  -> skill handles ongoing lifecycle:
       adopt existing repo
       create new repo
       re-scaffold/update
       run anvil doctor
       validate generated project
       troubleshoot drift/conflicts
```

#### Publication flow

```text
PR changes docs/start/skill/README templates
  -> docs build/check runs
  -> main merge deploys GitHub Pages
  -> published site exposes human docs, /start.md, and skill file
```

### Integration Points

- **Anvil release assets**: installation docs and `/start.md` must reference latest/pinned install behavior without hardcoding stale release URLs where avoidable.
- **`scripts/install.sh`**: installation docs must match actual installer behavior for latest and pinned versions.
- **CLI implementation**: CLI reference must match `anvil init`, `anvil doctor`, `--lang`, `--dry-run`, `--non-interactive`, and `--version`.
- **Generated project templates**: generated READMEs must align with Makefile targets and `AGENTS.md`.
- **GitHub Pages**: docs workflow owns build and deploy.
- **Coding harnesses**: skill installation docs provide portable Markdown-skill instructions first, with harness-specific notes where reliable.

### Key Interfaces

#### Homepage copy prompt

The homepage copy prompt is intentionally small:

```text
Fetch https://anvil.sh/start.md and follow it to install Anvil, adopt it safely in this repository, and run the validation loop.
```

If the canonical production host is GitHub Pages before a custom domain is configured, the prompt may use the GitHub Pages URL. The source should make the URL easy to change in one place.

#### `/start.md`

`/start.md` is agent-facing and concise. It must:

- Identify itself as the Anvil bootstrap prompt.
- Instruct the agent to preserve unrelated work.
- Tell the agent to inspect repository state before installing or writing.
- Select an install path in order: existing `anvil`, `bunx anvil`, standalone binary/installer.
- Verify with `anvil --version`.
- Ask the user whether to install the Anvil agent skill.
- Hand off to the installed skill when available.
- Provide a minimal fallback adoption flow when the user declines skill installation.
- Keep conflict handling conservative: dry-run first for existing repos, no blind overwrites.
- End with a concise report format.

`/start.md` must not become a full manual, language guide, or troubleshooting guide.

#### Installable Anvil agent skill

The skill is agent-facing and operational. It must include:

- Trigger conditions: install Anvil, adopt Anvil, update Anvil, re-scaffold, validate, troubleshoot, explain generated tooling.
- Core safety rules: preserve user changes, dry-run before existing-project writes, ask on ambiguous language/conflicts, do not invent secrets or versions.
- Workflows:
  - install/select Anvil
  - create a new Anvil project
  - adopt an existing repo
  - re-scaffold after an Anvil upgrade
  - run `anvil doctor`
  - install generated dependencies
  - run generated validation gates
  - troubleshoot common failures
- Reporting contract: language, install method, files changed, validation results, manual next steps.

The skill may link to human docs for explanations, but the actionable lifecycle protocol lives in the skill.

## What Changes

### New Artifacts

- `docs/` Astro Starlight site.
- `.github/workflows/docs.yml` for docs build/deploy.
- Hosted `/start.md` bootstrap prompt.
- Published Anvil skill file, initially as Markdown with frontmatter.
- Human docs pages:
  - Getting Started
  - Installation
  - CLI Reference
  - How Anvil Works
  - Using with Coding Agents
  - Existing Projects
  - Troubleshooting
  - TypeScript/JS Guide
  - Go Guide
  - Python Guide
  - Examples

### Updated Artifacts

- `README.md` becomes a short public landing page.
- `package.json` gains docs build/check scripts or delegates to `docs/package.json`.
- Generated project README templates explain Anvil-generated validation gates, seed code, `AGENTS.md`, `.anvil.lock`, and first commands.
- Existing governance/tests add contract coverage for docs workflow, `/start.md`, and skill boundaries.

### Workflow Changes

- Docs PRs run a docs build/check.
- Main branch deploys docs to GitHub Pages.
- Public release readiness includes checking that user-facing docs, `/start.md`, and the skill are present and non-overlapping.
- Users can adopt Anvil manually from docs or delegate adoption to a coding agent through the copy prompt.

## Failure Modes / Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `/start.md` grows into a full manual | Medium | Agents waste context and behave less reliably | Keep line/token budget and require skill handoff for lifecycle workflows |
| Skill duplicates human docs | Medium | Drift and contradictions | Enforce artifact responsibility table in tests/review checklist |
| Skill install differs across coding harnesses | High | Some users need manual setup | Ship portable Markdown skill first; document harness-specific install examples separately |
| Docs URLs change after custom domain setup | Medium | Copied prompts break | Centralize canonical docs URL and test homepage/start links |
| Docs site dependencies bloat root project | Medium | Slower contributor setup | Prefer isolated `docs/package.json` with root delegation scripts |
| Generated README wording implies seed code is disposable | Low | Agents may ignore seed conventions | Preserve D-37: generated READMEs describe seed/reference code as conventions to follow; deletion/disposability guidance remains CLI-output-only |
| CLI docs drift from Commander implementation | Medium | User confusion | Add contract tests or docs checks for CLI flags and command names |
| GitHub Pages deploy permissions fail | Medium | Site not published | Use standard Pages actions permissions and document repository Pages settings |

## Testing Strategy

### Work Type Classification

| Component | Work Type | Testing Approach |
|-----------|-----------|------------------|
| Docs site build/deploy workflow | infrastructure / ci-pipeline | Workflow contract tests plus GitHub Actions build validation |
| `/start.md` bootstrap prompt | glue-code / agent protocol | Static content checks for required steps, safety rules, and line budget |
| Anvil agent skill | glue-code / agent protocol | Static content checks for lifecycle workflows and non-overlap with `/start.md` |
| README and human docs | documentation | Link/build validation and review against artifact responsibility table |
| Generated project README templates | scaffold output | Fixture/e2e snapshots or template tests proving generated docs contain required user guidance |

### Acceptance Criteria

- **GIVEN** a public user opens the repository **WHEN** they read `README.md` **THEN** they can understand Anvil's purpose, install path, docs link, release link, and next action without reading internal specs.
- **GIVEN** a public user opens the docs site **WHEN** they navigate the sidebar **THEN** they can find installation, quickstart, CLI reference, how-it-works, coding-agent usage, existing-project adoption, troubleshooting, language guides, and examples.
- **GIVEN** a user copies the agent prompt into a coding harness **WHEN** the agent follows it **THEN** the agent fetches `/start.md`, installs/selects Anvil safely, verifies `anvil --version`, offers skill installation, and either hands off to the skill or runs the minimal fallback adoption flow.
- **GIVEN** the Anvil skill is installed **WHEN** the user asks the agent to adopt, update, re-scaffold, validate, or troubleshoot Anvil **THEN** the agent follows the skill workflow instead of re-fetching or expanding `/start.md`.
- **GIVEN** an existing repository **WHEN** an agent follows `/start.md` or the skill **THEN** it runs `anvil init --dry-run` before writing, preserves unrelated changes, and asks before resolving ambiguous conflicts.
- **GIVEN** docs or agent protocol files change **WHEN** CI runs **THEN** docs build/check validates the site and protocol contract before publication.
- **GIVEN** Anvil scaffolds a TypeScript, Go, or Python project **WHEN** the generated README is inspected **THEN** it explains the generated quality gates, seed/reference code, `AGENTS.md`, `.anvil.lock`, and first validation commands.

### Validation Lenses

| Lens | Result |
|------|--------|
| product-fit | Passes: public users get normal OSS docs while coding-agent users get a concise delegated adoption path. |
| architecture-fit | Passes: static docs align with Anvil's release model; agent protocol builds on existing `init`, `doctor`, `.anvil.lock`, and generated Makefile conventions. |
| operability | Passes: GitHub Pages deployment is standard; docs build/check can run in CI; `/start.md` and skill are static artifacts. |
| traceability | Passes: DOC requirements trace to D-75 and this spec; implementation tickets can cite `public-docs-agent-adoption`. |
| change-impact | Passes with localized changes: root README, new docs site, generated README templates, docs workflow, and static protocol checks. |

## Open Questions

- Which custom domain, if any, should be configured for the first public docs launch: GitHub Pages default or `anvil.sh`?
- Which coding harnesses should receive first-class skill installation examples in v1 docs?
- Should docs deployment be required for every PR, or should PRs build only and deployment happen only from `main`?
