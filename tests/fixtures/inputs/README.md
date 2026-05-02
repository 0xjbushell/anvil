# Sandbox input fixtures

This directory is the catalog of **input** sandboxes used by the fixture/scenario
harness (TIX-000059+). Each subdirectory represents a starting filesystem state
that anvil might encounter. The harness copies one of these dirs into
`.sandbox/scratch/<run-id>/` before invoking the CLI; nothing here is mutated
in place.

These fixtures are the *inputs* — they pair with scenario YAMLs (TIX-000059)
which declare the command to run and the expected output sandbox to diff
against (D-68).

## Directories

- **greenfield/** — empty directory (preserved with `.gitkeep`); exercises the
  cold-start path of `anvil init` against a brand-new working directory.
- **with-existing-code/** — has `src/foo.ts` but no `.anvil.lock`; exercises
  the `hasExistingCode` detection heuristic (CLI-04) where the user already
  has source files but anvil has never run here.
- **re-scaffold-clean/** — prior anvil run, no drift; the managed
  `Makefile`'s sha256 matches what's recorded in `.anvil.lock`. Re-running
  anvil should be a no-op (D-70 idempotency).
- **re-scaffold-drift/** — prior anvil run, but the user locally edited the
  managed `Makefile`. The lockfile checksum does NOT match disk; exercises
  the conflict reporter (D-67 §Part A) in non-interactive mode.
- **re-scaffold-template-bumped/** — prior anvil run with an OLDER anvil
  version (`0.0.1`); lockfile and disk match each other but anvil's current
  template content differs from what was previously written. Exercises
  UPDATE classification on re-scaffold when the template — not the user —
  has changed.
- **partial-toolchain/** — has `package.json` but intentionally NO
  `tsconfig.json`; exercises detection + safe defaults for partial setups.
- **monorepo/** — `package.json` declares `workspaces: ["packages/*"]`;
  exercises detection in workspace contexts.
- **dirty-git-repo/** — `.git/` is **not** committed in source control (it
  would interfere with the parent repo); instead `setup.sh` initializes a
  git repo on demand at sandbox-copy time and writes an uncommitted
  `README.md`. Exercises uncommitted-changes detection.
- **hostile/** — read-only file (`readonly.txt`, mode `0400` enforced by
  `setup.sh`) and an orphan PID lock (`.anvil.lock.pid` referencing dead
  PID `999999`) created at sandbox-copy time. Exercises safety paths and
  stale-lock cleanup.

## `setup.sh` contract

Some fixtures need state that can't (or shouldn't) live in source control —
a real `.git/` directory, restrictive Unix mode bits, etc. Those fixtures
ship a `setup.sh` script. The harness:

1. Copies the fixture dir into `.sandbox/scratch/<run-id>/`.
2. Runs `sh <copy>/setup.sh` if the file exists.
3. Then invokes the CLI under test.

`setup.sh` files are POSIX `sh`, idempotent, and safe to re-run. A non-zero
setup exit fails the scenario before Anvil runs, preserves setup stdout/stderr
in the failure details, and keeps the sandbox for inspection. If a contributor
wipes the scratch dir, simply re-running the harness (or `sh setup.sh`
manually) restores the expected state.

## Edge cases & contributor guidance

- **Lockfile format.** The `.anvil.lock` files in `re-scaffold-*` are
  hand-built YAML conforming to `AnvilLockfile` in `src/types.ts` (plus the
  `flushStatus` field required by D-70). The engine that reads/writes these
  lockfiles is TIX-000019. When that ticket lands, contributors may
  regenerate these fixtures via the engine OR keep them hand-built — either
  is acceptable as long as they remain valid.
- **Drift fixture.** The checksum recorded in
  `re-scaffold-drift/.anvil.lock` is intentionally bogus (a placeholder hex
  string). It represents "what anvil last wrote" diverging from "what the
  user has now"; do not try to make it match the on-disk Makefile.
- **Hostile on Windows.** The `hostile/` fixture relies on POSIX mode bits
  (`chmod 0400`). On Windows it should be skipped or specially handled by
  the harness — semantics differ.
- **Scratch is disposable.** Never edit files inside `.sandbox/scratch/`
  expecting them to persist. Edit the fixture under
  `tests/fixtures/inputs/<name>/` and re-run the harness.
