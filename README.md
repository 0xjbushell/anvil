# anvil

A scaffolding CLI.

## Installation

Bun users can run anvil directly:

    bunx anvil init --lang typescript

For environments without Bun, install the standalone binary:

    curl -fsSL https://anvil.sh/install.sh | sh

## Third-party code

Anvil vendors a small number of third-party libraries directly into
`src/internal/` per [D-67 §Part C](specs/decisions/anvil-decisions.md). See
[NOTICES.md](NOTICES.md) for attribution and license information.

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
`staticcheck`, `deadcode`, or Make are unavailable. This follows D-71/D-72: supported-language checks
must fail instead of skipping because a host-global tool is missing.

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
