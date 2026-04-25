import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, stat, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import { lock, unlock, check } from "./index.ts";

let scratch: string;
let file: string;

beforeEach(async () => {
  scratch = path.join(os.tmpdir(), `anvil-lockfile-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  file = path.join(scratch, "target.txt");
  await writeFile(file, "hello");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("lockfile", () => {
  test("clean lock creates <file>.lock/ directory", async () => {
    const release = await lock(file);
    const lockPath = `${file}.lock`;
    const st = await stat(lockPath);
    expect(st.isDirectory()).toBe(true);
    await release();
  });

  test("double-lock fails with ELOCKED", async () => {
    const release = await lock(file);
    let caught: unknown;
    try {
      await lock(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe("ELOCKED");
    await release();
  });

  test("release allows re-lock", async () => {
    const r1 = await lock(file);
    await r1();
    const r2 = await lock(file);
    await r2();
  });

  test("stale lock is reclaimed", async () => {
    const lockPath = `${file}.lock`;
    await mkdir(lockPath);
    // Set mtime well beyond the (minimum) 2000ms stale window.
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    const release = await lock(file);
    // Lock should have been reclaimed; mtime should now be recent.
    const st = await stat(lockPath);
    expect(Date.now() - st.mtime.getTime()).toBeLessThan(5_000);
    await release();
  });

  test("unlock without prior lock throws ENOTACQUIRED", async () => {
    let caught: unknown;
    try {
      await unlock(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe("ENOTACQUIRED");
  });

  test("unlock is idempotent only relative to the on-disk dir; second unlock throws ENOTACQUIRED", async () => {
    await lock(file);
    await unlock(file);
    // Second unlock: in-memory record is gone, so we throw ENOTACQUIRED.
    let caught: unknown;
    try {
      await unlock(file);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe("ENOTACQUIRED");
  });

  test("removing the on-disk lock dir before release does not cause release to throw", async () => {
    const release = await lock(file);
    // Externally remove the lock dir (simulates idempotency at the FS layer).
    await rm(`${file}.lock`, { recursive: true, force: true });
    // release() should not throw even though the dir is already gone.
    await release();
  });

  test("check reflects state", async () => {
    expect(await check(file)).toBe(false);
    const release = await lock(file);
    expect(await check(file)).toBe(true);
    await release();
    expect(await check(file)).toBe(false);
  });

  test("path-naming: lock dir is <file>.lock, original file untouched", async () => {
    const before = await stat(file);
    const release = await lock(file);

    // Original file is untouched (still a regular file with same content).
    const after = await stat(file);
    expect(after.isFile()).toBe(true);
    expect(after.size).toBe(before.size);

    // Lock is at <file>.lock, NOT at <file>.
    const lockPath = `${file}.lock`;
    const st = await stat(lockPath);
    expect(st.isDirectory()).toBe(true);

    await release();
    expect(await exists(lockPath)).toBe(false);
  });

  test("path-naming: locking a path ending in .lock produces <file>.lock.lock", async () => {
    const dotLockFile = path.join(scratch, "config.lock");
    await writeFile(dotLockFile, "data");

    const release = await lock(dotLockFile);
    const expectedLockPath = `${dotLockFile}.lock`;
    const st = await stat(expectedLockPath);
    expect(st.isDirectory()).toBe(true);
    expect(expectedLockPath.endsWith(".lock.lock")).toBe(true);
    await release();
  });

  test("stale threshold respected: fresh lock is not reclaimed", async () => {
    const lockPath = `${file}.lock`;
    await mkdir(lockPath);
    // Within the (minimum) 2000ms stale window — set mtime to ~now.
    const fresh = new Date();
    await utimes(lockPath, fresh, fresh);

    let caught: unknown;
    try {
      await lock(file);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe("ELOCKED");

    // Cleanup: remove the manually-created lock dir.
    await rm(lockPath, { recursive: true, force: true });
  });

  test("retries: ELOCKED gives up after exhausting retries", async () => {
    const lockPath = `${file}.lock`;
    await mkdir(lockPath);
    const fresh = new Date();
    await utimes(lockPath, fresh, fresh);

    const start = Date.now();
    let caught: unknown;
    try {
      await lock(file, { retries: { retries: 2, minTimeout: 50, maxTimeout: 100, factor: 1, randomize: false } });
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - start;
    expect((caught as { code?: string }).code).toBe("ELOCKED");
    // Two retries × ~50ms backoff each = at least ~100ms.
    expect(elapsed).toBeGreaterThanOrEqual(90);

    await rm(lockPath, { recursive: true, force: true });
  });
});
