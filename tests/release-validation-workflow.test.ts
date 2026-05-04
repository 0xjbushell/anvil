import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(import.meta.dir, "..");
const workflowPath = ".github/workflows/release-validation.yml";

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function runSteps(steps: unknown[]): string[] {
  return steps.flatMap((step) => {
    if (typeof step !== "object" || step === null || !("run" in step)) {
      return [];
    }

    const run = (step as { run?: unknown }).run;
    return typeof run === "string" ? [run.trim()] : [];
  });
}

describe("TIX-000083 release validation workflow", () => {
  test("runs the full no-skip release gate inside the Nix release environment", () => {
    const workflow = parseYaml(read(workflowPath));
    const triggers = workflow?.on ?? {};

    expect(triggers.workflow_dispatch).toBeDefined();
    expect(triggers.push?.tags).toContain("v*");
    expect(triggers.release?.types).toContain("published");

    const job = workflow?.jobs?.["release-validation"];
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    expect(job?.permissions ?? workflow?.permissions).toMatchObject({ contents: "read" });

    const steps = job?.steps ?? [];
    expect(steps.some((step: { uses?: string }) => step.uses === "actions/checkout@v4")).toBe(true);
    expect(
      steps.some((step: { uses?: string }) => step.uses === "cachix/install-nix-action@v31"),
    ).toBe(true);

    const commands = runSteps(steps);
    const validationCommands = [
      "scripts/nix-run.sh release -- scripts/require-tools.sh release",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun test tests/no-required-tool-skips.test.ts",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun agent:check",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun release:hygiene",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun fixtures",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bunx tsc --noEmit",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun test",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun test tests/e2e/typescript.test.ts tests/e2e/golang.test.ts tests/e2e/python.test.ts tests/parity/anti-slop-parity.test.ts tests/parity/structural-parity.test.ts tests/parity/test-quality-parity.test.ts",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun run build",
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun mutation",
    ];

    expect(commands).toContain("scripts/nix-run.sh release -- bun install --frozen-lockfile");
    expect(commands).toContain('git diff --exit-code && test -z "$(git status --porcelain)"');

    let previousIndex = -1;
    for (const command of validationCommands) {
      const index = commands.indexOf(command);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(commands).not.toContain("bun agent:check");
    expect(commands).not.toContain("bun fixtures");
    expect(commands).not.toContain("bun test");
    expect(commands).not.toContain("bun run build");
    expect(commands).not.toContain("bun mutation");

    const artifactStep = steps.find(
      (step: { uses?: string }) => step.uses === "actions/upload-artifact@v4",
    );
    expect(artifactStep).toMatchObject({
      if: "always()",
      with: {
        name: "release-validation-artifacts",
        "retention-days": 14,
      },
    });
  });
});
