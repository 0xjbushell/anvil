# anvil

A scaffolding CLI.

## Contributing

### Commit format

We follow [Conventional Commits](https://www.conventionalcommits.org/). Every commit on `main` must use:

    <type>(<optional scope>): <description>

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`.

The `commit-msg` hook (installed automatically via `bun install` → `husky`) validates this locally.

### Release process

Releases are automated via [release-please](https://github.com/googleapis/release-please-action). Every push to `main` updates an open release PR. To cut a release:

1. Merge the open `chore: release X.Y.Z` PR maintained by release-please.
2. release-please tags the merge commit and publishes the GitHub release with an auto-generated CHANGELOG.
3. No manual CHANGELOG edits — let release-please derive it from commit messages.

`git push --no-verify` skips the commit-msg hook locally; CI does not re-validate, so use sparingly and only for release-please's own commits.
