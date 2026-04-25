import { mkdir, stat, rmdir, utimes } from "node:fs/promises";
import path from "node:path";

export type Release = () => Promise<void>;

export interface RetryOptions {
  retries?: number;
  factor?: number;
  minTimeout?: number;
  maxTimeout?: number;
  randomize?: boolean;
}

export interface LockOptions {
  /** Stale threshold in ms. Floored at 2000. Default 10000. */
  stale?: number;
  /** mtime refresh interval in ms. Default `stale / 2`, clamped to [1000, stale/2]. */
  update?: number;
  /** Retry policy. A number is shorthand for `{ retries: n }`. */
  retries?: number | RetryOptions;
  /** Override the lockfile path. Default `<file>.lock`. */
  lockfilePath?: string;
  /** Called if the lock is compromised mid-hold. Default: re-throw. */
  onCompromised?: (err: Error & { code?: string }) => void;
}

interface ResolvedRetryOptions {
  retries: number;
  factor: number;
  minTimeout: number;
  maxTimeout: number;
  randomize: boolean;
}

interface ResolvedOptions {
  stale: number;
  update: number;
  retries: ResolvedRetryOptions;
  lockfilePath?: string;
  onCompromised: (err: Error & { code?: string }) => void;
}

interface HeldLock {
  lockfilePath: string;
  mtime: Date;
  options: ResolvedOptions;
  lastUpdate: number;
  released: boolean;
  updateTimeout: ReturnType<typeof setTimeout> | null;
  updateDelay: number | null;
}

const locks = new Map<string, HeldLock>();

const DEFAULT_RETRY: ResolvedRetryOptions = {
  retries: 0,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: Infinity,
  randomize: true,
};

function makeError(message: string, code: string, extras?: Record<string, unknown>): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  if (extras) Object.assign(err, extras);
  return err;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as { code?: unknown }).code === "string";
}

function getLockFile(file: string, options: ResolvedOptions): string {
  return options.lockfilePath ?? `${file}.lock`;
}

function resolveOptions(options: LockOptions | undefined): ResolvedOptions {
  const stale = Math.max(options?.stale ?? 10000, 2000);
  const updateRaw = options?.update == null ? stale / 2 : options.update || 0;
  const update = Math.max(Math.min(updateRaw, stale / 2), 1000);

  let retries: ResolvedRetryOptions;
  const r = options?.retries ?? 0;
  if (typeof r === "number") {
    retries = { ...DEFAULT_RETRY, retries: r };
  } else {
    retries = { ...DEFAULT_RETRY, ...r };
  }

  return {
    stale,
    update,
    retries,
    lockfilePath: options?.lockfilePath,
    onCompromised: options?.onCompromised ?? ((err) => { throw err; }),
  };
}

function isLockStale(mtime: Date, options: ResolvedOptions): boolean {
  return mtime.getTime() < Date.now() - options.stale;
}

async function removeLockDir(lockfilePath: string): Promise<void> {
  try {
    await rmdir(lockfilePath);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return;
    throw err;
  }
}

async function tryAcquire(
  file: string,
  options: ResolvedOptions,
  allowStaleReclaim: boolean,
): Promise<{ mtime: Date; lockfilePath: string }> {
  const lockfilePath = getLockFile(file, options);
  try {
    await mkdir(lockfilePath);
    const st = await stat(lockfilePath);
    return { mtime: st.mtime, lockfilePath };
  } catch (err) {
    if (!isErrnoException(err) || err.code !== "EEXIST") {
      throw err;
    }
    // Already exists — check staleness.
    let st;
    try {
      st = await stat(lockfilePath);
    } catch (statErr) {
      if (isErrnoException(statErr) && statErr.code === "ENOENT") {
        // Vanished between mkdir and stat — retry without stale-reclaim recursion.
        return tryAcquire(file, options, false);
      }
      throw statErr;
    }
    if (!allowStaleReclaim || !isLockStale(st.mtime, options)) {
      throw makeError("Lock file is already being held", "ELOCKED", { file });
    }
    // Stale — remove and retry once without further stale recursion.
    await removeLockDir(lockfilePath);
    return tryAcquire(file, options, false);
  }
}

function computeBackoff(attempt: number, retry: ResolvedRetryOptions): number {
  const base = retry.minTimeout * Math.pow(retry.factor, attempt);
  const random = retry.randomize ? Math.random() + 1 : 1;
  return Math.min(Math.round(base * random), retry.maxTimeout);
}

async function acquireWithRetry(file: string, options: ResolvedOptions): Promise<{ mtime: Date; lockfilePath: string }> {
  const { retries } = options;
  let attempt = 0;
  let lastErr: unknown;
  // Total tries = retries + 1 (initial attempt does not count as a retry).
  while (attempt <= retries.retries) {
    try {
      return await tryAcquire(file, options, true);
    } catch (err) {
      lastErr = err;
      // Only retry on ELOCKED — other errors are fatal.
      if (!isErrnoException(err) || err.code !== "ELOCKED") throw err;
      if (attempt === retries.retries) break;
      const delay = computeBackoff(attempt, retries);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  throw lastErr;
}

function setLockAsCompromised(key: string, lock: HeldLock, err: Error & { code?: string }): void {
  lock.released = true;
  if (lock.updateTimeout) {
    clearTimeout(lock.updateTimeout);
    lock.updateTimeout = null;
  }
  if (locks.get(key) === lock) {
    locks.delete(key);
  }
  lock.options.onCompromised(err);
}

function scheduleUpdate(key: string, lock: HeldLock): void {
  if (lock.updateTimeout || lock.released) return;
  const delay = lock.updateDelay ?? lock.options.update;
  lock.updateDelay = null;

  lock.updateTimeout = setTimeout(() => {
    lock.updateTimeout = null;
    void refreshLock(key, lock);
  }, delay);

  // Don't keep the event loop alive just to refresh a lock.
  if (typeof lock.updateTimeout.unref === "function") {
    lock.updateTimeout.unref();
  }
}

async function refreshLock(key: string, lock: HeldLock): Promise<void> {
  if (lock.released) return;
  const overThreshold = (): boolean => lock.lastUpdate + lock.options.stale < Date.now();

  let st;
  try {
    st = await stat(lock.lockfilePath);
  } catch (err) {
    if (lock.released) return;
    const ee = isErrnoException(err) ? err : null;
    if (ee?.code === "ENOENT" || overThreshold()) {
      const e = makeError(
        ee?.message ?? "Lock compromised",
        "ECOMPROMISED",
      );
      setLockAsCompromised(key, lock, e);
      return;
    }
    lock.updateDelay = 1000;
    scheduleUpdate(key, lock);
    return;
  }

  if (st.mtime.getTime() !== lock.mtime.getTime()) {
    setLockAsCompromised(
      key,
      lock,
      makeError("Unable to update lock within the stale threshold", "ECOMPROMISED"),
    );
    return;
  }

  const now = new Date();
  try {
    await utimes(lock.lockfilePath, now, now);
  } catch (err) {
    if (lock.released) return;
    const ee = isErrnoException(err) ? err : null;
    if (ee?.code === "ENOENT" || overThreshold()) {
      setLockAsCompromised(
        key,
        lock,
        makeError(ee?.message ?? "Lock compromised", "ECOMPROMISED"),
      );
      return;
    }
    lock.updateDelay = 1000;
    scheduleUpdate(key, lock);
    return;
  }

  if (lock.released) return;
  lock.mtime = now;
  lock.lastUpdate = Date.now();
  scheduleUpdate(key, lock);
}

export async function lock(file: string, options?: LockOptions): Promise<Release> {
  const resolved = resolveOptions(options);
  const key = path.resolve(file);

  const { mtime, lockfilePath } = await acquireWithRetry(key, resolved);

  const held: HeldLock = {
    lockfilePath,
    mtime,
    options: resolved,
    lastUpdate: Date.now(),
    released: false,
    updateTimeout: null,
    updateDelay: null,
  };
  locks.set(key, held);
  scheduleUpdate(key, held);

  let releaseCalled = false;
  return async function release(): Promise<void> {
    if (releaseCalled) {
      throw makeError("Lock is already released", "ERELEASED");
    }
    releaseCalled = true;
    if (held.released) {
      // Compromised mid-hold — surface to the caller.
      throw makeError("Lock is already released", "ERELEASED");
    }
    held.released = true;
    if (held.updateTimeout) {
      clearTimeout(held.updateTimeout);
      held.updateTimeout = null;
    }
    if (locks.get(key) === held) locks.delete(key);
    await removeLockDir(lockfilePath);
  };
}

export async function unlock(file: string): Promise<void> {
  const key = path.resolve(file);
  const held = locks.get(key);
  if (!held) {
    throw makeError("Lock is not acquired/owned by you", "ENOTACQUIRED");
  }
  held.released = true;
  if (held.updateTimeout) {
    clearTimeout(held.updateTimeout);
    held.updateTimeout = null;
  }
  locks.delete(key);
  await removeLockDir(held.lockfilePath);
}

export async function check(file: string, options?: LockOptions): Promise<boolean> {
  const resolved = resolveOptions(options);
  const key = path.resolve(file);
  const lockfilePath = getLockFile(key, resolved);
  try {
    const st = await stat(lockfilePath);
    return !isLockStale(st.mtime, resolved);
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return false;
    throw err;
  }
}
