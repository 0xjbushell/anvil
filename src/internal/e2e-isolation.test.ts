import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { createE2eIsolation, withE2eIsolation } from "./e2e-isolation.ts";

const scratchRoots = new Set<string>();

afterEach(() => {
  for (const root of scratchRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  scratchRoots.clear();
});

function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "anvil-e2e-isolation-test-"));
  scratchRoots.add(root);
  return root;
}

function expectPathInside(root: string, value: string | undefined, label: string): void {
  expect(value, `${label} must be set`).toBeDefined();
  expect(path.isAbsolute(value ?? ""), `${label} must be absolute`).toBe(true);
  const relative = path.relative(root, value ?? "");
  expect(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)), `${label} inside ${root}`).toBe(
    true,
  );
}

describe("e2e isolation", () => {
  test("creates a fresh isolated env for each test without host cache or home leakage", () => {
    const parentDir = scratchRoot();
    const hostRoot = path.join(parentDir, "host");
    const hostEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: path.join(hostRoot, "home"),
      TMPDIR: path.join(hostRoot, "tmp"),
      XDG_CACHE_HOME: path.join(hostRoot, "xdg-cache"),
      GOCACHE: path.join(hostRoot, "go-cache"),
      GOMODCACHE: path.join(hostRoot, "gomod-cache"),
      GOLANGCI_LINT_CACHE: path.join(hostRoot, "golangci-cache"),
      HUSKY: "1",
      GIT_CONFIG_GLOBAL: path.join(hostRoot, ".gitconfig"),
    };

    const first = createE2eIsolation({
      suiteName: "golang",
      testName: "lint one",
      baseEnv: hostEnv,
      parentDir,
    });
    const second = createE2eIsolation({
      suiteName: "golang",
      testName: "lint two",
      baseEnv: hostEnv,
      parentDir,
    });

    expect(first.root).not.toBe(second.root);
    expect(first.root).toContain(`${path.sep}.anvil-env${path.sep}`);
    expect(second.root).toContain(`${path.sep}.anvil-env${path.sep}`);

    for (const key of [
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "GOCACHE",
      "GOMODCACHE",
      "GOPATH",
      "GOLANGCI_LINT_CACHE",
      "PRE_COMMIT_HOME",
      "BUN_INSTALL_CACHE_DIR",
      "UV_CACHE_DIR",
      "PIP_CACHE_DIR",
      "npm_config_cache",
    ] as const) {
      expectPathInside(first.root, first.env[key], `first ${key}`);
      expect(first.env[key], `first ${key} must not reuse host value`).not.toBe(hostEnv[key]);
      expectPathInside(second.root, second.env[key], `second ${key}`);
      expect(second.env[key], `second ${key} must be unique`).not.toBe(first.env[key]);
    }

    expectPathInside(first.root, first.env.GIT_CONFIG_GLOBAL, "GIT_CONFIG_GLOBAL");
    expectPathInside(first.root, first.env.ANVIL_PTY_STATE_DIR, "ANVIL_PTY_STATE_DIR");
    expect(first.env.HUSKY).toBe("0");
    expect(first.env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(first.env.GOWORK).toBe("off");
    expect(first.env.PYTHONDONTWRITEBYTECODE).toBe("1");
    expect(first.env.UV_NO_PROGRESS).toBe("1");
  });

  test("restores process.env and removes the isolation root after a failing action", async () => {
    const parentDir = scratchRoot();
    const originalHome = process.env.HOME;
    const originalTmpDir = process.env.TMPDIR;
    let isolationRoot = "";

    await expect(
      withE2eIsolation(
        {
          suiteName: "typescript",
          testName: `throws-${randomUUID()}`,
          parentDir,
        },
        async ({ env, root }) => {
          isolationRoot = root;
          expect(process.env.HOME).toBe(env.HOME);
          expect(process.env.TMPDIR).toBe(env.TMPDIR);
          throw new Error("intentional failure");
        },
      ),
    ).rejects.toThrow("intentional failure");

    expect(process.env.HOME).toBe(originalHome);
    expect(process.env.TMPDIR).toBe(originalTmpDir);
    expect(isolationRoot).not.toBe("");
    expect(existsSync(isolationRoot)).toBe(false);
  });

  test("restores process.env after a successful synchronous void action", () => {
    const parentDir = scratchRoot();
    const originalHome = process.env.HOME;
    let isolationRoot = "";

    withE2eIsolation(
      {
        suiteName: "typescript",
        testName: `sync-void-${randomUUID()}`,
        parentDir,
      },
      ({ env, root }) => {
        isolationRoot = root;
        expect(process.env.HOME).toBe(env.HOME);
      },
    );

    expect(process.env.HOME).toBe(originalHome);
    expect(isolationRoot).not.toBe("");
    expect(existsSync(isolationRoot)).toBe(false);
  });
});
