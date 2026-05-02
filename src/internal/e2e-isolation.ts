import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface CreateE2eIsolationOptions {
  suiteName: string;
  testName?: string;
  parentDir?: string;
  baseEnv?: NodeJS.ProcessEnv;
  pathPrepend?: readonly string[];
}

export interface E2eIsolation {
  root: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

type EnvAction<T> = (isolation: E2eIsolation) => T | Promise<T>;

const safeSegmentPattern = /[^A-Za-z0-9._-]+/g;

function safeSegment(value: string): string {
  const normalized = value.replace(safeSegmentPattern, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 80) : "run";
}

function mkdirInside(root: string, relativePath: string): string {
  const directory = path.join(root, relativePath);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function touchInside(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "", { flag: "a" });
  return filePath;
}

function pathWithPrepend(baseEnv: NodeJS.ProcessEnv, prepend: readonly string[]): string | undefined {
  const entries = [...prepend, baseEnv.PATH].filter((entry): entry is string => entry !== undefined && entry.length > 0);
  return entries.length === 0 ? undefined : entries.join(path.delimiter);
}

function makeWritableForRemoval(targetPath: string): void {
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (stat.isDirectory()) {
    chmodSync(targetPath, 0o700);
    for (const entry of readdirSync(targetPath)) {
      makeWritableForRemoval(path.join(targetPath, entry));
    }
    return;
  }

  if (stat.isFile()) {
    chmodSync(targetPath, 0o600);
  }
}

function removeWritableTree(root: string): void {
  makeWritableForRemoval(root);
  rmSync(root, { recursive: true, force: true });
}

export function createE2eIsolation(options: CreateE2eIsolationOptions): E2eIsolation {
  const baseEnv = options.baseEnv ?? process.env;
  const parentDir = path.resolve(options.parentDir ?? tmpdir());
  const rootParent = path.join(parentDir, ".anvil-env");
  mkdirSync(rootParent, { recursive: true });

  const root = mkdtempSync(path.join(rootParent, `${safeSegment(`${options.suiteName}-${options.testName ?? "run"}`)}-`));
  const tmp = mkdirInside(root, "tmp");
  const goPath = mkdirInside(root, "go");
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    HOME: mkdirInside(root, "home"),
    USERPROFILE: mkdirInside(root, "home"),
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_CACHE_HOME: mkdirInside(root, "xdg/cache"),
    XDG_CONFIG_HOME: mkdirInside(root, "xdg/config"),
    XDG_DATA_HOME: mkdirInside(root, "xdg/data"),
    XDG_STATE_HOME: mkdirInside(root, "xdg/state"),
    GOCACHE: mkdirInside(root, "go/cache"),
    GOMODCACHE: mkdirInside(root, "go/pkg/mod"),
    GOPATH: goPath,
    GOENV: touchInside(root, "go/env"),
    GOWORK: "off",
    GOLANGCI_LINT_CACHE: mkdirInside(root, "golangci-lint/cache"),
    PRE_COMMIT_HOME: mkdirInside(root, "pre-commit"),
    GIT_CONFIG_GLOBAL: touchInside(root, "git/config"),
    GIT_CONFIG_NOSYSTEM: "1",
    HUSKY: "0",
    BUN_INSTALL_CACHE_DIR: mkdirInside(root, "bun/install-cache"),
    npm_config_cache: mkdirInside(root, "npm/cache"),
    NPM_CONFIG_CACHE: mkdirInside(root, "npm/cache"),
    YARN_CACHE_FOLDER: mkdirInside(root, "yarn/cache"),
    PNPM_HOME: mkdirInside(root, "pnpm/home"),
    PNPM_STORE_DIR: mkdirInside(root, "pnpm/store"),
    UV_CACHE_DIR: mkdirInside(root, "uv/cache"),
    UV_NO_PROGRESS: "1",
    UV_PYTHON_PREFERENCE: "only-system",
    PIP_CACHE_DIR: mkdirInside(root, "pip/cache"),
    PYTHONDONTWRITEBYTECODE: "1",
    ANVIL_PTY_STATE_DIR: mkdirInside(root, "pty"),
    ANVIL_E2E_ISOLATION_ROOT: root,
    NO_COLOR: baseEnv.NO_COLOR ?? "1",
  };
  const pathValue = pathWithPrepend(baseEnv, options.pathPrepend ?? []);
  if (pathValue !== undefined) {
    env.PATH = pathValue;
  }

  let cleaned = false;
  return {
    root,
    env,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      removeWritableTree(root);
    },
  };
}

function replaceProcessEnv(nextEnv: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(nextEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function withE2eIsolation<T>(
  options: CreateE2eIsolationOptions,
  action: EnvAction<T>,
): T | Promise<T> {
  const isolation = createE2eIsolation(options);
  const previousEnv = { ...process.env };
  replaceProcessEnv(isolation.env);

  const restore = (): void => {
    replaceProcessEnv(previousEnv);
    isolation.cleanup();
  };

  try {
    const result = action(isolation);
    if (isPromiseLike(result)) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}
