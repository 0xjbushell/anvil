import { describe, expect, test } from "bun:test";

import pkg from "../package.json" with { type: "json" };
import type { ToolchainDefaults } from "../src/internal/toolchain-defaults.ts";
import { createSnapshot } from "./refresh-toolchain-defaults.ts";

const dayMs = 24 * 60 * 60 * 1000;
const versions = {
  node: "24.15.0",
  go: "1.26.2",
  python: "3.14.4",
  bun: "1.3.13",
};

function existingDefaults(snapshotTakenAt: string): ToolchainDefaults {
  return {
    snapshotTakenAt,
    snapshotAnvilVersion: pkg.version,
    ...versions,
  };
}

describe("refresh toolchain defaults", () => {
  test("updates an unchanged snapshot timestamp when the existing snapshot is stale", () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const staleTimestamp = new Date(now.getTime() - 91 * dayMs).toISOString();

    const snapshot = createSnapshot(versions, existingDefaults(staleTimestamp), now);

    expect(snapshot).toEqual({
      snapshotTakenAt: "2026-04-25T00:00:00.000Z",
      snapshotAnvilVersion: pkg.version,
      ...versions,
    });
  });
});
