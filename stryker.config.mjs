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
  "src/commands/init.ts:200-227",
  "src/commands/init.ts:273-319",
  "src/commands/init.ts:322-355",
  "src/commands/init.ts:358-377",
  "src/commands/init-context.ts:123-146",
  "src/commands/init-context.ts:233-250",
  "src/commands/init-context.ts:338-355",
  "src/commands/init-context.ts:425-469",
  "src/commands/init-post.ts:40-53",
  "src/commands/init-post.ts:140-175",
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
