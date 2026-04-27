export const mutationTestCommand = "bun test tests/crap-score.test.ts src/dev/changed.test.ts";

export const mutationTargets = [
  "static/typescript/tools/crap-score.ts:61-63",
  "static/typescript/tools/crap-score.ts:108-116",
  "static/typescript/tools/crap-score.ts:290-293",
  "src/dev/changed.ts:48-55",
  "src/dev/changed.ts:64-66",
];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: mutationTestCommand,
  },
  mutate: [...mutationTargets],
  reporters: ["clear-text"],
  coverageAnalysis: "off",
  thresholds: { high: 90, low: 80, break: 80 },
  timeoutMS: 60_000,
  concurrency: 1,
  cleanTempDir: "always",
};
