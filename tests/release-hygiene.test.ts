import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  analyzeReleaseHygiene,
  formatReleaseHygieneReport,
  parseTixPayload,
  type TixItem,
} from "../scripts/check-release-hygiene.ts";

const repoRoot = path.resolve(import.meta.dir, "..");

function item(overrides: Partial<TixItem>): TixItem {
  return {
    id: "TIX-000000",
    type: "Deliverable",
    description: "Release work",
    agentState: "Done",
    closeStatus: "pending_close",
    tags: ["release-readiness"],
    ...overrides,
  };
}

describe("TIX-000086 release hygiene", () => {
  test("blocks open shipped-scope executable deliverables", () => {
    const result = analyzeReleaseHygiene([
      item({ id: "TIX-000072", type: "Story", agentState: "Todo" }),
      item({ id: "TIX-000076", type: "Feature", parent: "TIX-000072", agentState: "Todo" }),
      item({
        id: "TIX-000999",
        type: "Deliverable",
        parent: "TIX-000076",
        agentState: "Doing",
        closeStatus: "open",
        description: "Unfinished release task",
      }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.openDeliverables.map((candidate) => candidate.id)).toEqual(["TIX-000999"]);
    expect(formatReleaseHygieneReport(result)).toContain("TIX-000999");
  });

  test("documents parent rollups without treating them as executable release work", () => {
    const result = analyzeReleaseHygiene([
      item({ id: "TIX-000072", type: "Story", agentState: "Todo", closeStatus: "open" }),
      item({ id: "TIX-000076", type: "Feature", parent: "TIX-000072", agentState: "Todo" }),
      item({ id: "TIX-000086", type: "Deliverable", parent: "TIX-000076" }),
    ]);

    expect(result.ok).toBe(true);
    expect(result.parentRollups.map((candidate) => candidate.id)).toEqual(["TIX-000072", "TIX-000076"]);
    expect(formatReleaseHygieneReport(result)).toContain("Documented parent rollups");
  });

  test("parses tix list and status JSON payloads", () => {
    expect(parseTixPayload({ items: [item({ id: "TIX-000086" })] }).map((candidate) => candidate.id)).toEqual([
      "TIX-000086",
    ]);
    expect(
      parseTixPayload({
        lists: {
          ready: [item({ id: "TIX-000072", type: "Story" })],
          inProgress: [item({ id: "TIX-000086" })],
        },
      }).map((candidate) => candidate.id),
    ).toEqual(["TIX-000072", "TIX-000086"]);
  });

  test("release workflow and package script wire the hygiene gate", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/release-validation.yml"), "utf8");
    const spec = readFileSync(path.join(repoRoot, "specs/toolchain/release-validation-and-distribution.md"), "utf8");

    expect(pkg.scripts["release:hygiene"]).toBe("bun scripts/check-release-hygiene.ts");
    expect(workflow).toContain(
      "scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun release:hygiene",
    );
    expect(spec).toContain("Parent rollups");
  });
});
