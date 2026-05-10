---
title: Troubleshooting
description: Common recovery paths for generated tooling and validation failures.
---

Start with `anvil doctor` when generated tooling looks misconfigured. It applies safe fixes and reports issues that require manual review. Do not hand-edit `.anvil.lock`; rerun Anvil or doctor so the provenance stays consistent.

When a generated-project validation command fails, read the failing tool output first, fix the cause, and rerun the same Makefile target before escalating to broader checks. For coding agents, this is the intended backpressure loop: fix the narrow signal, prove the narrow signal, then rerun the handoff gate.

## Common paths

| Symptom | First check |
| --- | --- |
| Generated lint config looks stale | Run `anvil doctor`, then rerun the failing Make target. |
| Existing repo adoption reports conflicts | Review the conflict report; rerun `anvil init --dry-run` after resolving. |
| A required validation tool is missing | Enter the generated Nix shell or install dependencies described in the generated README. |
| `make check` fails | Fix the first failing target, rerun that target, then rerun `make check`. |

## When to re-scaffold

Re-run `anvil init --lang <language> --dry-run` after upgrading Anvil or when you want to preview updated generated files. Existing `.anvil.lock` context lets Anvil reuse the scaffold answers and classify generated-file changes. If a file has been edited locally, treat the update prompt or conflict report as a decision point rather than noise.
