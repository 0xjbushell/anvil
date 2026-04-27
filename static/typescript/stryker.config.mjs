/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.spec.ts"],
  testRunner: "vitest",
  reporters: ["clear-text", "html"],
  coverageAnalysis: "perTest",
  thresholds: { high: 80, low: 60, break: 50 },
};
