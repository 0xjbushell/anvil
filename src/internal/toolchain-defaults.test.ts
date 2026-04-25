import { describe, expect, test } from "bun:test";

import pkg from "../../package.json" with { type: "json" };
import bundledDefaults from "./toolchain-defaults.json" with { type: "json" };
import {
  isToolchainDefaultsFresh,
  loadToolchainDefaults,
  validateToolchainDefaults,
  type ToolchainDefaults,
} from "./toolchain-defaults.ts";

const semverShape = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const dayMs = 24 * 60 * 60 * 1000;
const versionFields = ["snapshotAnvilVersion", "node", "go", "python", "bun"] as const;
const bundledSnapshotFreshnessReference = new Date("2026-04-25T04:08:15.000Z");
const validSnapshot: ToolchainDefaults = {
  snapshotTakenAt: "2026-04-24T00:00:00.000Z",
  snapshotAnvilVersion: "0.1.0",
  node: "22.11.0",
  go: "1.23.4",
  python: "3.13.0",
  bun: "1.1.34",
};

describe("toolchain defaults", () => {
  test("shipped JSON has the required schema", () => {
    const defaults = validateToolchainDefaults(bundledDefaults);

    expect(defaults.snapshotTakenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(defaults.snapshotTakenAt))).toBe(false);
    expect(defaults.snapshotAnvilVersion).toBe(pkg.version);
    expect(defaults.snapshotAnvilVersion).toMatch(semverShape);
    expect(defaults.node).toMatch(semverShape);
    expect(defaults.go).toMatch(semverShape);
    expect(defaults.python).toMatch(semverShape);
    expect(defaults.bun).toMatch(semverShape);
  });

  test("shipped JSON snapshot is fresh for this release", () => {
    const defaults = validateToolchainDefaults(bundledDefaults);

    expect(isToolchainDefaultsFresh(defaults, bundledSnapshotFreshnessReference)).toBe(true);
  });

  test("schema validation rejects missing, empty, malformed, and mistyped values", () => {
    const invalidCases: Array<[string, unknown]> = [
      ["invalid snapshotTakenAt", { ...validSnapshot, snapshotTakenAt: "not-a-date" }],
      [
        "impossible snapshotTakenAt",
        { ...validSnapshot, snapshotTakenAt: "2026-02-30T00:00:00.000Z" },
      ],
      ["date-only snapshotTakenAt", { ...validSnapshot, snapshotTakenAt: "2026-04-24" }],
      [
        "locale-formatted snapshotTakenAt",
        { ...validSnapshot, snapshotTakenAt: "4/24/2026, 12:00:00 AM" },
      ],
    ];

    for (const field of versionFields) {
      const missingField: Record<string, unknown> = { ...validSnapshot };
      delete missingField[field];
      invalidCases.push(
        [`missing ${field}`, missingField],
        [`empty ${field}`, { ...validSnapshot, [field]: "" }],
        [`malformed ${field}`, { ...validSnapshot, [field]: "22" }],
        [`mistyped ${field}`, { ...validSnapshot, [field]: 123 }],
      );
    }

    for (const [name, value] of invalidCases) {
      expect(() => validateToolchainDefaults(value), name).toThrow();
    }
  });

  test("loadToolchainDefaults returns a typed bundled snapshot", () => {
    const defaults: ToolchainDefaults = loadToolchainDefaults();

    expect(defaults).toEqual(validateToolchainDefaults(bundledDefaults));
  });

  test("loader imports the bundled JSON snapshot directly", async () => {
    const loaderSource = await Bun.file(new URL("./toolchain-defaults.ts", import.meta.url)).text();

    expect(loaderSource).toMatch(
      /import\s+\w+\s+from\s+["']\.\/toolchain-defaults\.json["']\s+with\s+\{\s*type:\s*["']json["']\s*\}/,
    );
  });

  test("freshness passes for a fresh snapshot and the 90-day boundary", () => {
    const now = new Date("2026-04-24T12:00:00.000Z");
    const freshDefaults = {
      ...loadToolchainDefaults(),
      snapshotTakenAt: now.toISOString(),
    };
    const boundaryDefaults = {
      ...loadToolchainDefaults(),
      snapshotTakenAt: new Date(now.getTime() - 90 * dayMs).toISOString(),
    };

    expect(isToolchainDefaultsFresh(freshDefaults, now)).toBe(true);
    expect(isToolchainDefaultsFresh(boundaryDefaults, now)).toBe(true);
  });

  test("freshness fails for a 91-day-old snapshot", () => {
    const now = new Date("2026-04-24T12:00:00.000Z");
    const staleSnapshot = new Date(now.getTime() - 91 * dayMs);
    const defaults = {
      ...loadToolchainDefaults(),
      snapshotTakenAt: staleSnapshot.toISOString(),
    };

    expect(isToolchainDefaultsFresh(defaults, now)).toBe(false);
  });
});
