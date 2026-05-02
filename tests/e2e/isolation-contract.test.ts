import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const repoRoot = path.resolve(import.meta.dir, "../..");
const e2eFiles = [
  "tests/e2e/golang.test.ts",
  "tests/e2e/python.test.ts",
  "tests/e2e/typescript.test.ts",
] as const;

describe("TIX-000082 e2e isolation contract", () => {
  test("package scripts expose repeated full-suite validation commands", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

    expect(pkg.scripts?.["test:repeat"]).toContain("for i in 1 2 3");
    expect(pkg.scripts?.["test:repeat"]).toContain('"$npm_execpath" test "$@"');
    expect(pkg.scripts?.["nix:test:repeat"]).toContain("scripts/nix-run.sh release");
    expect(pkg.scripts?.["nix:test:repeat"]).toContain("scripts/require-tools.sh release");
    expect(pkg.scripts?.["nix:test:repeat"]).toContain('bun test "$@"');
    expect(pkg.scripts?.["nix:test:repeat"]).toContain("for i in 1 2 3");
  });

  test("Python parity installs the Flake8 plugin from an isolated workspace copy", () => {
    const source = readFileSync(path.join(repoRoot, "tests/parity/parity-helpers.ts"), "utf8");

    expect(source).toContain("copyPythonPlugin(workspace)");
    expect(source).not.toContain("--with-editable\",\n        pythonPluginRoot");
  });

  for (const relativePath of e2eFiles) {
    test(`${relativePath} uses the shared e2e isolation helper`, () => {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(source).toContain("src/internal/e2e-isolation");
      expect(source).toMatch(/\bcreateE2eIsolation\b/);
      expect(source).not.toMatch(/env:\s*process\.env\b/);
      expect(source).not.toMatch(/\.\.\.process\.env/);
    });
  }
});
