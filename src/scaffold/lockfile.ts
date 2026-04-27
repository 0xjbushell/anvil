import { createHash } from "node:crypto";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";

import type { AnvilLockfile, LockfileEntry, LockfileReadResult, ScaffoldContext } from "../types.ts";

export const LOCKFILE_NAME = ".anvil.lock";

export interface LockfileDiff {
  added: LockfileEntry[];
  removed: LockfileEntry[];
  changed: Array<{
    path: string;
    oldChecksum: string;
    newChecksum: string;
    status: LockfileEntry["status"];
  }>;
  unchanged: LockfileEntry[];
}

export interface LockfileInputFile {
  path: string;
  content: string | Buffer;
}

const textExtensions = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".tsx",
  ".jsx",
  ".go",
  ".py",
  ".md",
  ".yml",
  ".yaml",
  ".json",
  ".toml",
  ".txt",
  ".sh",
  ".mod",
  ".sum",
  ".ejs",
]);

const textBasenames = new Set([
  "Makefile",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".prettierrc",
  ".flake8",
]);

const binaryExtensions = new Set([".png", ".jpg", ".gif", ".ico", ".woff", ".woff2"]);

function getLockfilePath(dir: string): string {
  return path.join(dir, LOCKFILE_NAME);
}

function cloneLockfile(lock: AnvilLockfile): AnvilLockfile {
  return {
    version: lock.version,
    lang: lock.lang,
    flushStatus: lock.flushStatus,
    context: { ...lock.context },
    toolchain: { ...lock.toolchain },
    files: lock.files.map((file) => ({ ...file })),
    createdAt: lock.createdAt,
    updatedAt: lock.updatedAt,
  };
}

function contentBuffer(content: string | Buffer): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
}

function checksumForFile(file: LockfileInputFile): string {
  return computeChecksum(normalizeForChecksum(contentBuffer(file.content), isTextFile(file.path)));
}

function optionalContextFields(ctx: ScaffoldContext): Pick<
  AnvilLockfile["context"],
  "packageManager" | "sourceDir"
> {
  return {
    ...(ctx.packageManager !== undefined ? { packageManager: ctx.packageManager } : {}),
    ...(ctx.sourceDir !== undefined ? { sourceDir: ctx.sourceDir } : {}),
  };
}

function corruptLockfile(error: unknown): LockfileReadResult {
  return { status: "corrupt", lockfile: null, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLang(value: unknown): value is AnvilLockfile["lang"] {
  return value === "typescript" || value === "golang" || value === "python";
}

function isPackageManager(value: unknown): value is NonNullable<AnvilLockfile["context"]["packageManager"]> {
  return value === "bun" || value === "npm" || value === "pnpm" || value === "yarn";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isLockfileFlushStatus(value: unknown): value is AnvilLockfile["flushStatus"] {
  return value === "complete" || value === "in-progress";
}

function isLockfileEntryStatus(value: unknown): value is LockfileEntry["status"] {
  return value === "written" || value === "pending";
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return Array.isArray(value) ? "array" : typeof value;
}

function isLockfileContext(value: unknown): value is AnvilLockfile["context"] {
  return (
    isRecord(value) &&
    typeof value.projectName === "string" &&
    (value.packageManager === undefined || isPackageManager(value.packageManager)) &&
    typeof value.defaultBranch === "string" &&
    isOptionalString(value.sourceDir) &&
    typeof value.skipSeed === "boolean" &&
    typeof value.year === "number" &&
    Number.isFinite(value.year)
  );
}

function isToolchainVersions(value: unknown): value is AnvilLockfile["toolchain"] {
  return (
    isRecord(value) &&
    isOptionalString(value.bun) &&
    isOptionalString(value.node) &&
    isOptionalString(value.go) &&
    isOptionalString(value.python)
  );
}

function isLockfileEntry(value: unknown): value is LockfileEntry {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.checksum === "string" &&
    isLockfileEntryStatus(value.status)
  );
}

function isAnvilLockfile(value: unknown): value is AnvilLockfile {
  return (
    isRecord(value) &&
    typeof value.version === "string" &&
    isLang(value.lang) &&
    isLockfileFlushStatus(value.flushStatus) &&
    isLockfileContext(value.context) &&
    isToolchainVersions(value.toolchain) &&
    Array.isArray(value.files) &&
    value.files.every(isLockfileEntry) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function classifyLockfile(value: unknown): LockfileReadResult {
  if (!isRecord(value)) {
    return corruptLockfile(new Error(`Invalid lockfile: expected object, received ${describeValue(value)}`));
  }

  if (!isLockfileFlushStatus(value.flushStatus)) {
    return corruptLockfile(
      new Error(
        `Invalid lockfile flushStatus: expected "complete" or "in-progress", received ${describeValue(
          value.flushStatus,
        )}`,
      ),
    );
  }

  if (!isAnvilLockfile(value)) {
    return corruptLockfile(new Error("Invalid lockfile: structure does not match the D-70 schema"));
  }

  return {
    status: value.flushStatus,
    lockfile: value,
  };
}

export async function readLockfile(dir: string): Promise<LockfileReadResult> {
  const file = Bun.file(getLockfilePath(dir));
  if (!(await file.exists())) {
    return { status: "absent", lockfile: null };
  }

  const raw = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return corruptLockfile(error);
  }

  return classifyLockfile(parsed);
}

export async function writeLockfile(dir: string, lock: AnvilLockfile): Promise<void> {
  await writeFileAtomic(getLockfilePath(dir), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export function computeChecksum(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function normalizeForChecksum(buf: Buffer, isText: boolean): Buffer {
  if (!isText) {
    return Buffer.from(buf);
  }

  // Normalize CRLF first, then remove a trailing standalone CR left by some editors.
  const normalized = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r$/, "");
  return Buffer.from(normalized, "utf8");
}

export function isTextFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalizedPath);

  if (textBasenames.has(basename)) {
    return true;
  }

  const extension = path.posix.extname(basename).toLowerCase();
  if (binaryExtensions.has(extension)) {
    return false;
  }

  return textExtensions.has(extension);
}

export function diffLockfiles(oldLock: AnvilLockfile, newLock: AnvilLockfile): LockfileDiff {
  const oldByPath = new Map(oldLock.files.map((file) => [file.path, file]));
  const newByPath = new Map(newLock.files.map((file) => [file.path, file]));

  const added: LockfileEntry[] = [];
  const changed: LockfileDiff["changed"] = [];
  const unchanged: LockfileEntry[] = [];

  for (const newEntry of newLock.files) {
    const oldEntry = oldByPath.get(newEntry.path);
    if (!oldEntry) {
      added.push(newEntry);
      continue;
    }

    if (oldEntry.checksum !== newEntry.checksum) {
      changed.push({
        path: newEntry.path,
        oldChecksum: oldEntry.checksum,
        newChecksum: newEntry.checksum,
        status: newEntry.status,
      });
      continue;
    }

    unchanged.push(newEntry);
  }

  const removed = oldLock.files.filter((oldEntry) => !newByPath.has(oldEntry.path));

  return {
    added,
    removed,
    changed,
    unchanged,
  };
}

export function createLockfile(ctx: ScaffoldContext, files: LockfileInputFile[]): AnvilLockfile {
  const now = new Date();
  const timestamp = now.toISOString();

  return {
    version: ctx.anvilVersion,
    lang: ctx.lang,
    flushStatus: "complete",
    context: {
      projectName: ctx.projectName,
      ...optionalContextFields(ctx),
      defaultBranch: ctx.defaultBranch,
      skipSeed: ctx.skipSeed,
      year: ctx.year ?? now.getFullYear(),
    },
    toolchain: { ...ctx.toolchain },
    files: [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        checksum: checksumForFile(file),
        status: "written",
      })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function writeLockfileCheckpoint(
  dir: string,
  lock: AnvilLockfile,
  intendedEntries: LockfileEntry[] = lock.files,
): Promise<AnvilLockfile> {
  const checkpoint: AnvilLockfile = {
    ...cloneLockfile(lock),
    flushStatus: "in-progress",
    files: intendedEntries.map((entry) => ({ ...entry, status: "pending" as const })),
    updatedAt: new Date().toISOString(),
  };

  await writeLockfile(dir, checkpoint);
  return checkpoint;
}

export async function markEntryWritten(
  dir: string,
  lock: AnvilLockfile,
  entryPath: string,
): Promise<AnvilLockfile> {
  let matched = false;
  const files = lock.files.map((entry) => {
    if (entry.path !== entryPath) {
      return { ...entry };
    }

    matched = true;
    return { ...entry, status: "written" as const };
  });

  if (!matched) {
    throw new Error(`Cannot mark lockfile entry as written: "${entryPath}" is not tracked`);
  }

  const updated = {
    ...cloneLockfile(lock),
    files,
    updatedAt: new Date().toISOString(),
  };

  await writeLockfile(dir, updated);
  return updated;
}

export async function finalizeLockfile(dir: string, lock: AnvilLockfile): Promise<AnvilLockfile> {
  const pendingEntries = lock.files.filter((entry) => entry.status === "pending");
  if (pendingEntries.length > 0) {
    throw new Error(
      `Cannot finalize lockfile with pending entries: ${pendingEntries.map((entry) => entry.path).join(", ")}`,
    );
  }

  const finalized: AnvilLockfile = {
    ...cloneLockfile(lock),
    flushStatus: "complete",
    updatedAt: new Date().toISOString(),
  };

  await writeLockfile(dir, finalized);
  return finalized;
}
