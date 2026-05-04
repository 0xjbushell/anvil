import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  assertRequiredTools,
  commandRequirement,
  missingRequiredTools,
  python311Requirement,
} from "./required-tools.ts";

function withPath(commands: string[], operation: (env: NodeJS.ProcessEnv) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "anvil-required-tools-"));

  try {
    for (const command of commands) {
      const file = path.join(dir, command);
      writeFileSync(file, "#!/bin/sh\nexit 0\n");
      chmodSync(file, 0o755);
    }

    operation({ PATH: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("required tool assertions", () => {
  test("reports missing uv, gitleaks, and govulncheck as hard environment failures", () => {
    const env = { PATH: mkdtempSync(path.join(tmpdir(), "anvil-empty-path-")) };

    try {
      const result = missingRequiredTools([
        commandRequirement("uv"),
        commandRequirement("gitleaks"),
        commandRequirement("govulncheck"),
      ], { env });

      expect(result.missing).toEqual(["uv", "gitleaks", "govulncheck"]);
      expect(result.available).toBe(false);
      expect(() =>
        assertRequiredTools("release e2e", [
          commandRequirement("uv"),
          commandRequirement("gitleaks"),
          commandRequirement("govulncheck"),
        ], {
          env,
          nixEntrypoint: "bun run nix:test -- tests/e2e tests/parity",
        }),
      ).toThrow(/release e2e environment is missing required tools[\s\S]*D-71\/D-72[\s\S]*bun run nix:test/);
    } finally {
      rmSync(env.PATH, { recursive: true, force: true });
    }
  });

  test("accepts absolute commands and Python 3.11 custom probes", () => {
    withPath(["python3"], (env) => {
      const python = path.join(env.PATH ?? "", "python3");
      writeFileSync(
        python,
        "#!/bin/sh\ncase \"$1\" in -c) exit 0 ;; *) exit 0 ;; esac\n",
      );
      chmodSync(python, 0o755);

      expect(missingRequiredTools([
        commandRequirement("current bun", process.execPath),
        python311Requirement(),
      ], { env }).missing).toEqual([]);
    });
  });

  test("treats non-executable PATH entries as missing tools", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anvil-non-executable-path-"));
    const tool = path.join(dir, "uv");

    try {
      writeFileSync(tool, "#!/bin/sh\nexit 0\n");
      chmodSync(tool, 0o644);

      expect(missingRequiredTools([commandRequirement("uv")], { env: { PATH: dir } }).missing).toEqual(["uv"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
