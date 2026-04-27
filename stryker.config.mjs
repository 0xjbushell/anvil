export const mutationTestCommand = [
  "bun test",
  "tests/crap-score.test.ts",
  "src/dev/changed.test.ts",
  "src/commands/init-context.test.ts",
  "src/commands/init-post.test.ts",
  "src/commands/init.test.ts",
  "src/internal/toolchain-defaults.test.ts",
  "src/scaffold/conflict-reporter.test.ts",
].join(" ");

export const mutationTargets = [
  "static/typescript/tools/crap-score.ts:61-63",
  "static/typescript/tools/crap-score.ts:108-116",
  "static/typescript/tools/crap-score.ts:290-293",
  "src/dev/changed.ts:48-55",
  "src/dev/changed.ts:64-66",
  "src/commands/init.ts:194-221",
  "src/commands/init.ts:267-313",
  "src/commands/init.ts:316-349",
  "src/commands/init.ts:352-371",
  "src/commands/init-context.ts:112-136",
  "src/commands/init-context.ts:225-243",
  "src/commands/init-context.ts:330-353",
  "src/commands/init-context.ts:417-461",
  "src/commands/init-post.ts:35-47",
  "src/commands/init-post.ts:130-166",
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
