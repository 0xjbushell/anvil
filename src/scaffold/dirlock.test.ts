import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { acquire } from "./dirlock.ts";

const PAYLOAD_NAME = ".anvil.lock.pid";
const STALE_LOCK_AGE_MS = 60 * 24 * 60 * 60 * 1000;

let scratch: string;

beforeEach(async () => {
  scratch = path.join(os.tmpdir(), `anvil-dirlock-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function payloadPath(): string {
  return path.join(scratch, PAYLOAD_NAME);
}

function lockDirPath(): string {
  return `${payloadPath()}.lock`;
}

async function readPayload(): Promise<{ pid: number; startTime: number }> {
  return JSON.parse(await readFile(payloadPath(), "utf8")) as { pid: number; startTime: number };
}

async function writePayload(payload: { pid: number; startTime: number }): Promise<void> {
  await writeFile(payloadPath(), `${JSON.stringify(payload)}\n`, "utf8");
}

async function writeFreshHeldLock(payload: { pid: number; startTime: number }): Promise<void> {
  await mkdir(lockDirPath());
  await writePayload(payload);
}

async function writeFreshLockDirOnly(): Promise<void> {
  await mkdir(lockDirPath());
}

async function ageLockDirPastVendorStaleThreshold(): Promise<void> {
  const staleTime = new Date(Date.now() - STALE_LOCK_AGE_MS);
  await utimes(lockDirPath(), staleTime, staleTime);
}

describe("scaffold directory lock", () => {
  test("clean acquire writes pid payload and creates sibling lock directory while held", async () => {
    const handle = await acquire(scratch);

    const payload = await readPayload();
    const payloadStat = await stat(payloadPath());
    const lockStat = await stat(lockDirPath());

    expect(payload.pid).toBe(process.pid);
    expect(payload.startTime).toBeNumber();
    expect(Number.isFinite(payload.startTime)).toBe(true);
    expect(payload.startTime).toBeGreaterThan(0);
    expect(payload.startTime).toBeLessThanOrEqual(Date.now());
    expect(payloadStat.isFile()).toBe(true);
    expect(lockStat.isDirectory()).toBe(true);

    await handle.release();
  });

  test("second acquire while first is held throws a clear message containing the running pid", async () => {
    const handle = await acquire(scratch);

    await expect(acquire(scratch)).rejects.toThrow(new RegExp(String(process.pid)));

    await handle.release();
  });

  test("stale lock with a dead pid is reclaimed and overwritten", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await writeFreshHeldLock({ pid: 999_999_999, startTime: 1 });

    const handle = await acquire(scratch);
    const payload = await readPayload();

    expect(payload.pid).toBe(process.pid);
    expect(payload.startTime).not.toBe(1);
    expect(await exists(lockDirPath())).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("999999999"));

    await handle.release();
    warn.mockRestore();
  });

  test("stale lock with same pid but mismatched startTime is reclaimed and overwritten", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await writeFreshHeldLock({ pid: process.pid, startTime: 1 });

    const handle = await acquire(scratch);
    const payload = await readPayload();

    expect(payload.pid).toBe(process.pid);
    expect(payload.startTime).not.toBe(1);
    expect(await exists(lockDirPath())).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(String(process.pid)));

    await handle.release();
    warn.mockRestore();
  });

  test("fresh underlying lock with missing payload is treated as initializing and not reclaimed", async () => {
    await writeFreshLockDirOnly();
    const beforeLockStat = await stat(lockDirPath());

    await expect(acquire(scratch)).rejects.toThrow(/scaffold.*progress.*payload/i);

    const afterLockStat = await stat(lockDirPath());
    expect(await exists(payloadPath())).toBe(false);
    expect(afterLockStat.isDirectory()).toBe(true);
    expect(afterLockStat.mtimeMs).toBe(beforeLockStat.mtimeMs);
  });

  test("fresh underlying lock with partial payload is treated as initializing and not overwritten", async () => {
    await writeFreshLockDirOnly();
    await writeFile(payloadPath(), "{", "utf8");
    const beforeLockStat = await stat(lockDirPath());

    await expect(acquire(scratch)).rejects.toThrow(/scaffold.*progress.*payload/i);

    const afterLockStat = await stat(lockDirPath());
    expect(await readFile(payloadPath(), "utf8")).toBe("{");
    expect(afterLockStat.isDirectory()).toBe(true);
    expect(afterLockStat.mtimeMs).toBe(beforeLockStat.mtimeMs);
  });

  test("stale underlying lock with missing payload is reclaimed by the vendored stale path", async () => {
    await writeFreshLockDirOnly();
    await ageLockDirPastVendorStaleThreshold();

    const handle = await acquire(scratch);
    const payload = await readPayload();

    expect(payload.pid).toBe(process.pid);
    expect(payload.startTime).toBeNumber();
    expect(await exists(lockDirPath())).toBe(true);

    await handle.release();
  });

  test("stale underlying lock with partial payload is reclaimed and overwritten", async () => {
    await writeFreshLockDirOnly();
    await writeFile(payloadPath(), "{", "utf8");
    await ageLockDirPastVendorStaleThreshold();

    const handle = await acquire(scratch);
    const payload = await readPayload();

    expect(payload.pid).toBe(process.pid);
    expect(payload.startTime).toBeNumber();
    expect(await exists(lockDirPath())).toBe(true);

    await handle.release();
  });

  test("release is idempotent, removes payload, and releases the underlying lock", async () => {
    const handle = await acquire(scratch);

    await rm(payloadPath(), { force: true });
    await handle.release();
    await expect(handle.release()).resolves.toBeUndefined();

    expect(await exists(payloadPath())).toBe(false);
    expect(await exists(lockDirPath())).toBe(false);

    const reacquired = await acquire(scratch);
    await reacquired.release();
  });

  test("source uses the vendored internal lock module and not the npm package", async () => {
    const source = await readFile(path.join(import.meta.dir, "dirlock.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["']proper-lockfile["']/);
    expect(source).toMatch(/from\s+["']\.\.\/internal\/lockfile\/lockfile\.ts["']/);
    expect(source).toMatch(/liveStartTime === null[\s\S]*status: "stale"/);
  });
});
