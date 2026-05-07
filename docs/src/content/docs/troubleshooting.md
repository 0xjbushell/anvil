---
title: Troubleshooting
description: Common recovery paths for generated tooling and validation failures.
---

Start with `anvil doctor` when generated tooling looks misconfigured. It applies safe fixes and reports issues that require manual review.

When a generated-project validation command fails, read the failing tool output first, fix the cause, and rerun the same Makefile target before escalating to broader checks.

## Common paths

| Symptom | First check |
| --- | --- |
| Generated lint config looks stale | Run `anvil doctor`, then rerun the failing Make target. |
| Existing repo adoption reports conflicts | Review the conflict report; rerun `anvil init --dry-run` after resolving. |
| A required validation tool is missing | Enter the generated Nix shell or install dependencies described in the generated README. |
| `make check` fails | Fix the first failing target, rerun that target, then rerun `make check`. |
