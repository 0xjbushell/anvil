#!/usr/bin/env bun

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import existingDefaultsJson from "../src/internal/toolchain-defaults.json" with { type: "json" };
import {
  isToolchainDefaultsFresh,
  validateToolchainDefaults,
  type ToolchainDefaults,
} from "../src/internal/toolchain-defaults.ts";

const bunLatestUrl = "https://github.com/oven-sh/bun/releases/latest";
const nodeIndexUrl = "https://nodejs.org/dist/index.json";
const goDownloadsUrl = "https://go.dev/dl/?mode=json";
const pythonReleasesUrl = "https://endoflife.date/api/python.json";
const semverShape = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const userAgent = "anvil-toolchain-defaults-refresh";

interface ResolvedToolchainVersions {
  node: string;
  go: string;
  python: string;
  bun: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSemver(raw: string, prefix: string): string {
  const withoutPrefix = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (!semverShape.test(withoutPrefix)) {
    throw new TypeError(`resolved version "${raw}" is not semver-shaped`);
  }
  return withoutPrefix;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

async function resolveNode(): Promise<string> {
  const releases = await fetchJson(nodeIndexUrl);
  if (!Array.isArray(releases)) {
    throw new TypeError("Node index response must be an array");
  }

  for (const release of releases) {
    if (!isRecord(release)) continue;
    const version = release.version;
    if (typeof version === "string" && release.lts !== false) {
      return normalizeSemver(version, "v");
    }
  }

  throw new Error("Node index response did not include an LTS release");
}

async function resolveGo(): Promise<string> {
  const releases = await fetchJson(goDownloadsUrl);
  if (!Array.isArray(releases)) {
    throw new TypeError("Go downloads response must be an array");
  }

  for (const release of releases) {
    if (!isRecord(release)) continue;
    const version = release.version;
    if (typeof version === "string" && !version.includes("rc")) {
      return normalizeSemver(version, "go");
    }
  }

  throw new Error("Go downloads response did not include a stable release");
}

async function resolvePython(): Promise<string> {
  const releases = await fetchJson(pythonReleasesUrl);
  if (!Array.isArray(releases)) {
    throw new TypeError("Python releases response must be an array");
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const release of releases) {
    if (!isRecord(release)) continue;
    const latest = release.latest;
    const eol = release.eol;
    if (typeof latest === "string" && typeof eol === "string" && eol > today) {
      return normalizeSemver(latest, "");
    }
  }

  throw new Error("Python releases response did not include an active stable release");
}

function parseBunVersion(input: string): string | null {
  const match = /bun-v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(input);
  return match ? normalizeSemver(match[1], "") : null;
}

async function resolveBun(): Promise<string> {
  const response = await fetch(bunLatestUrl, {
    headers: { "User-Agent": userAgent },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`GET ${bunLatestUrl} failed with ${response.status} ${response.statusText}`);
  }

  const versionFromUrl = parseBunVersion(response.url);
  if (versionFromUrl) {
    return versionFromUrl;
  }

  const body = await response.text();
  const versionFromBody = parseBunVersion(body);
  if (versionFromBody) {
    return versionFromBody;
  }

  throw new Error("Bun latest release page did not expose a semver tag");
}

async function resolveToolchainVersions(): Promise<ResolvedToolchainVersions> {
  const [node, go, python, bun] = await Promise.all([
    resolveNode(),
    resolveGo(),
    resolvePython(),
    resolveBun(),
  ]);
  return { node, go, python, bun };
}

export function createSnapshot(
  versions: ResolvedToolchainVersions,
  existing: ToolchainDefaults,
  now = new Date(),
): ToolchainDefaults {
  const unchanged =
    existing.snapshotAnvilVersion === pkg.version &&
    existing.node === versions.node &&
    existing.go === versions.go &&
    existing.python === versions.python &&
    existing.bun === versions.bun;
  const preserveTimestamp = unchanged && isToolchainDefaultsFresh(existing, now);

  return {
    snapshotTakenAt: preserveTimestamp
      ? existing.snapshotTakenAt
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
    snapshotAnvilVersion: pkg.version,
    node: versions.node,
    go: versions.go,
    python: versions.python,
    bun: versions.bun,
  };
}

async function main(): Promise<void> {
  const existingDefaults = validateToolchainDefaults(existingDefaultsJson);
  const versions = await resolveToolchainVersions();
  const nextDefaults = validateToolchainDefaults(createSnapshot(versions, existingDefaults));
  const defaultsPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/internal/toolchain-defaults.json",
  );

  await Bun.write(defaultsPath, `${JSON.stringify(nextDefaults, null, 2)}\n`);
  console.log(`refreshed ${defaultsPath}`);
}

if (import.meta.main) {
  await main();
}
