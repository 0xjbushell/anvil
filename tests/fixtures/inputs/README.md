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
- **re-scaffold-clean/** — `setup.sh` creates a prior TypeScript anvil run
  with no drift. Re-running anvil should be a no-op (D-70 idempotency).
- **re-scaffold-drift/** — `setup.sh` creates a prior TypeScript anvil run,
  then locally edits the managed `Makefile` without updating `.anvil.lock`.
  Re-running anvil exercises the conflict reporter (D-67 §Part A) in
  non-interactive mode and must write nothing.
- **re-scaffold-template-bumped/** — `setup.sh` creates a prior TypeScript
  anvil run, then rewrites the managed `Makefile` and checksum to simulate an
  older template version (`0.0.1`). Dry-run re-scaffold must classify the
  current template as an UPDATE without writing.
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
2. Runs `sh <copy>/setup.sh` if the file exists, with `ANVIL_REPO_ROOT`,
   `ANVIL_BIN`, and `ANVIL_BUN` pointing at the current repo checkout.
3. Then invokes the CLI under test.

`setup.sh` files are POSIX `sh`, idempotent, and safe to re-run. A non-zero
setup exit fails the scenario before Anvil runs, preserves setup stdout/stderr
in the failure details, and keeps the sandbox for inspection. If a contributor
wipes the scratch dir, simply re-running the harness (or `sh setup.sh`
manually) restores the expected state.

## Edge cases & contributor guidance

- **Lockfile format.** Re-scaffold fixtures generate JSON `.anvil.lock` files
  through the current engine during `setup.sh`; do not hand-author YAML
  lockfiles here.
- **Drift fixture.** `re-scaffold-drift/setup.sh` intentionally changes
  `Makefile` after the baseline lockfile is written. Do not update the
  checksum for that fixture.
- **Hostile on Windows.** The `hostile/` fixture relies on POSIX mode bits
  (`chmod 0400`). On Windows it should be skipped or specially handled by
  the harness — semantics differ.
- **Scratch is disposable.** Never edit files inside `.sandbox/scratch/`
  expecting them to persist. Edit the fixture under
  `tests/fixtures/inputs/<name>/` and re-run the harness.
