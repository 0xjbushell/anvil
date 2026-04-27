import { describe, expect, test } from "bun:test";

import strykerConfig, { mutationTargets, mutationTestCommand } from "../stryker.config.mjs";
import pkg from "../package.json" with { type: "json" };

describe("Stryker mutation gate", () => {
  test("package scripts run mutation through Stryker", () => {
    expect(pkg.scripts?.mutation).toBe("stryker run");
    expect(pkg.scripts?.quality).toBe("bun mutation");
    expect(pkg.devDependencies?.["@stryker-mutator/core"]).toBe("9.6.1");
  });

  test("uses Stryker's command runner against focused Bun tests", () => {
    expect(strykerConfig).toMatchObject({
      testRunner: "command",
      coverageAnalysis: "off",
      reporters: ["clear-text"],
      thresholds: {
        break: 80,
      },
    });
    expect(strykerConfig.commandRunner.command).toBe(mutationTestCommand);
    expect(strykerConfig.mutate).toEqual([...mutationTargets]);
  });
});
