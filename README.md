# Anvil

Anvil is an agent-ready project scaffolder for TypeScript/JavaScript, Go, and Python. It installs strict local validation gates, seed/reference code, and concise agent guidance so humans and coding agents can build inside the same guardrails.

It turns agentic engineering backpressure into ordinary repository files: local checks fail early, generated conventions stay visible, and agents get concrete feedback before code reaches review.

## Installation

Start a new project with Bun:

```bash
bunx anvil init --lang typescript
```

For existing repositories, read the adoption flow first so Anvil can dry-run changes and preserve your code.

For standalone binaries without Bun in the target environment:

```bash
curl -fsSL https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh | bash
```

- [Full documentation](https://0xjbushell.github.io/anvil/)
- [Releases](https://github.com/0xjbushell/anvil/releases)
- [CHANGELOG.md](CHANGELOG.md)
- [Contributing](#contributing)

## What Anvil adds

- Language-specific Makefile targets for lint, typecheck, tests, coverage, audit, CRAP score, and mutation checks.
- Local hooks and Nix-backed environments that make required validation reproducible.
- `.anvil.lock` provenance so re-running `anvil init` can classify generated-file changes safely.
- `AGENTS.md` and seed/reference code that teach coding agents the repo-local conventions to follow.

## Third-party code

Anvil includes third-party attribution in [NOTICES.md](NOTICES.md).

## Contributing

### Commit format

We follow [Conventional Commits](https://www.conventionalcommits.org/). Every commit on `main` must use:

    <type>(<optional scope>): <description>

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`.

Hook installation is opt-in. Run `scripts/install-hooks.sh` after installing dependencies to
configure Git to use the `.husky/` hooks. The `commit-msg` hook validates this locally.

### Quality checks

The canonical validation path is Nix-backed and does not require host-global tool setup. With Nix
installed, run:

    scripts/nix-run.sh release -- scripts/require-tools.sh release
    scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun agent:check
    scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun fixtures

If Bun is already available, equivalent package aliases are available:

    bun run nix:env:check
    bun run nix:agent:check
    bun run nix:fixtures

These wrappers enter the repository `release` shell before validation and fail clearly if required tools
such as Bun, Node/native build tools, Go, Python, `uv`, `gitleaks`, `govulncheck`, `golangci-lint`,
`staticcheck`, `deadcode`, or Make are unavailable. Supported-language checks fail instead of
skipping because a host-global tool is missing.

The `pre-push` hook runs `bun fixtures` only before code leaves your machine and blocks the push if
fixtures fail. `git push --no-verify` skips the local `pre-push` hook when you need an emergency
bypass. Mutation remains the manual final quality gate: run `bun quality` or `bun mutation` at the
quality/delivery boundary, or rely on CI for PR verification. CI reruns `bun fixtures` and
`bun mutation` through the same shell wrappers for pull requests and pushes to `main`.

### Release process

Releases are automated via [release-please](https://github.com/googleapis/release-please-action). Every push to `main` updates an open release PR. To cut a release:

1. Merge the open `chore: release X.Y.Z` PR maintained by release-please.
2. release-please tags the merge commit and publishes the GitHub release with an auto-generated CHANGELOG.
3. No manual CHANGELOG edits — let release-please derive it from commit messages.

`git commit --no-verify` skips the commit-msg hook locally; use it sparingly and only for
release-please's own commits.
