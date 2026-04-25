import bundledDefaults from "./toolchain-defaults.json" with { type: "json" };

export interface ToolchainDefaults {
  snapshotTakenAt: string;
  snapshotAnvilVersion: string;
  node: string;
  go: string;
  python: string;
  bun: string;
}

export const TOOLCHAIN_DEFAULTS_MAX_AGE_DAYS = 90;

const dayMs = 24 * 60 * 60 * 1000;
const semverShape = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const utcIsoTimestampShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const versionFields = ["snapshotAnvilVersion", "node", "go", "python", "bun"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, field: keyof ToolchainDefaults): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new TypeError(`toolchain defaults field "${field}" must be a string`);
  }
  return value;
}

function readSemverField(record: Record<string, unknown>, field: keyof ToolchainDefaults): string {
  const value = readStringField(record, field);
  if (!semverShape.test(value)) {
    throw new TypeError(`toolchain defaults field "${field}" must be a semver-shaped string`);
  }
  return value;
}

function isStrictUtcIsoTimestamp(value: string): boolean {
  if (!utcIsoTimestampShape.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function validateToolchainDefaults(value: unknown): ToolchainDefaults {
  if (!isRecord(value)) {
    throw new TypeError("toolchain defaults must be a JSON object");
  }

  const snapshotTakenAt = readStringField(value, "snapshotTakenAt");
  if (!isStrictUtcIsoTimestamp(snapshotTakenAt)) {
    throw new TypeError(
      'toolchain defaults field "snapshotTakenAt" must be a strict UTC ISO timestamp',
    );
  }

  const versions = Object.fromEntries(
    versionFields.map((field) => [field, readSemverField(value, field)]),
  ) as Pick<ToolchainDefaults, (typeof versionFields)[number]>;

  return {
    snapshotTakenAt,
    snapshotAnvilVersion: versions.snapshotAnvilVersion,
    node: versions.node,
    go: versions.go,
    python: versions.python,
    bun: versions.bun,
  };
}

export function isToolchainDefaultsFresh(
  defaults: Pick<ToolchainDefaults, "snapshotTakenAt">,
  now = new Date(),
): boolean {
  if (!isStrictUtcIsoTimestamp(defaults.snapshotTakenAt)) {
    return false;
  }

  const snapshotMs = new Date(defaults.snapshotTakenAt).getTime();
  const nowMs = now.getTime();
  if (Number.isNaN(snapshotMs) || Number.isNaN(nowMs)) {
    return false;
  }

  const ageMs = nowMs - snapshotMs;
  return ageMs >= 0 && ageMs <= TOOLCHAIN_DEFAULTS_MAX_AGE_DAYS * dayMs;
}

export function loadToolchainDefaults(): ToolchainDefaults {
  return validateToolchainDefaults(bundledDefaults);
}
