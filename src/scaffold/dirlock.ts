import { execFile } from "node:child_process";
import { readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { lock } from "../internal/lockfile/lockfile.ts";
import type { LockOptions, Release } from "../internal/lockfile/lockfile.ts";

export interface DirLockHandle {
  release(): Promise<void>;
}

interface DirLockPayload {
  pid: number;
  startTime: number;
}

interface InternalLockHandle {
  release: Release;
  compromisedError(): Error | null;
}

type VoidPromiseResult = { status: "fulfilled" } | { status: "rejected"; reason: unknown };

type ExistingLockStatus =
  | { status: "live"; pid: number }
  | { status: "stale"; reason: string; pid?: number }
  | { status: "possibly-live"; reason: string };

const PAYLOAD_NAME = ".anvil.lock.pid";
const DAY_MS = 24 * 60 * 60 * 1000;
const VENDOR_STALE_MS = 14 * DAY_MS;
const LINUX_DEFAULT_CLK_TCK = 100;

const execFileAsync = promisify(execFile);
const currentProcessFallbackStartTime = Math.round(Date.now() - process.uptime() * 1000);

let clockTicksPerSecond: Promise<number> | null = null;

const POSIX_ERRNO_BY_CODE: Record<string, number> = {
  EACCES: 13,
  EINVAL: 22,
  ENOENT: 2,
  ENOTDIR: 20,
  EPERM: 1,
  ESRCH: 3,
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException & { errno?: number } {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; errno?: unknown };
  return typeof candidate.code === "string" || typeof candidate.errno === "number";
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (!isErrnoException(error)) {
    return false;
  }

  if (error.code === code) {
    return true;
  }

  return typeof error.errno === "number" && Math.abs(error.errno) === POSIX_ERRNO_BY_CODE[code];
}

function isChildProcessExitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return typeof (error as { code?: unknown }).code === "number";
}

function payloadPath(targetDir: string): string {
  return path.join(path.resolve(targetDir), PAYLOAD_NAME);
}

function lockDirPath(pidFile: string): string {
  return `${path.resolve(pidFile)}.lock`;
}

function makeLiveLockError(pid: number): Error & { code: string; pid: number } {
  const error = new Error(`Scaffold already in progress for this directory (running PID ${pid}).`) as Error & {
    code: string;
    pid: number;
  };
  error.code = "ELOCKED";
  error.pid = pid;
  return error;
}

function makePossiblyInitializingLockError(reason: string): Error & { code: string } {
  const error = new Error(
    `Scaffold already in progress for this directory; lock payload is ${reason}.`,
  ) as Error & { code: string };
  error.code = "ELOCKED";
  return error;
}

function isPayload(value: unknown): value is DirLockPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { pid?: unknown; startTime?: unknown };
  return (
    Number.isSafeInteger(candidate.pid) &&
    Number(candidate.pid) > 0 &&
    typeof candidate.startTime === "number" &&
    Number.isFinite(candidate.startTime) &&
    candidate.startTime > 0
  );
}

async function readExistingPayload(pidFile: string): Promise<ExistingLockStatus | { status: "payload"; payload: DirLockPayload }> {
  let raw: string;
  try {
    raw = await readFile(pidFile, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { status: "possibly-live", reason: "missing" };
    }
    if (hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")) {
      return { status: "possibly-live", reason: "unreadable" };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { status: "possibly-live", reason: "invalid JSON" };
  }

  if (!isPayload(parsed)) {
    return { status: "possibly-live", reason: "invalid shape" };
  }

  return { status: "payload", payload: parsed };
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ESRCH") || hasErrorCode(error, "EINVAL")) {
      return false;
    }
    if (hasErrorCode(error, "EPERM")) {
      return true;
    }
    throw error;
  }
}

async function getClockTicksPerSecond(): Promise<number> {
  if (clockTicksPerSecond === null) {
    clockTicksPerSecond = execFileAsync("getconf", ["CLK_TCK"], { encoding: "utf8" })
      .then(({ stdout }) => {
        const parsed = Number(String(stdout).trim());
        return Number.isFinite(parsed) && parsed > 0 ? parsed : LINUX_DEFAULT_CLK_TCK;
      })
      .catch(() => LINUX_DEFAULT_CLK_TCK);
  }

  return clockTicksPerSecond;
}

async function readLinuxProcessStartTime(pid: number): Promise<number | null> {
  if (process.platform !== "linux") {
    return null;
  }

  let procStat: string;
  let processStat: string;
  try {
    [procStat, processStat] = await Promise.all([
      readFile("/proc/stat", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
  } catch (error) {
    if (
      hasErrorCode(error, "ENOENT") ||
      hasErrorCode(error, "ENOTDIR") ||
      hasErrorCode(error, "EACCES") ||
      hasErrorCode(error, "EPERM")
    ) {
      return null;
    }
    throw error;
  }

  const bootTimeLine = procStat.split("\n").find((line) => line.startsWith("btime "));
  const bootTimeSeconds = bootTimeLine === undefined ? NaN : Number(bootTimeLine.slice("btime ".length).trim());
  const closingParen = processStat.lastIndexOf(")");
  if (!Number.isFinite(bootTimeSeconds) || closingParen === -1) {
    return null;
  }

  const fields = processStat.slice(closingParen + 1).trim().split(/\s+/);
  const startTimeTicks = Number(fields[19]);
  if (!Number.isFinite(startTimeTicks)) {
    return null;
  }

  const clockTicks = await getClockTicksPerSecond();
  return Math.round(bootTimeSeconds * 1000 + (startTimeTicks / clockTicks) * 1000);
}

async function readPsProcessStartTime(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
    const parsed = Date.parse(String(stdout).trim());
    return Number.isNaN(parsed) ? null : parsed;
  } catch (error) {
    if (
      hasErrorCode(error, "ENOENT") ||
      hasErrorCode(error, "ESRCH") ||
      hasErrorCode(error, "EINVAL") ||
      hasErrorCode(error, "EPERM") ||
      isChildProcessExitError(error)
    ) {
      return null;
    }
    throw error;
  }
}

async function getProcessStartTime(pid: number): Promise<number | null> {
  return (await readLinuxProcessStartTime(pid)) ?? (await readPsProcessStartTime(pid));
}

async function currentProcessStartTime(): Promise<number> {
  return (await getProcessStartTime(process.pid)) ?? currentProcessFallbackStartTime ?? Date.now();
}

async function inspectExistingLock(pidFile: string): Promise<ExistingLockStatus> {
  const payload = await readExistingPayload(pidFile);
  if (payload.status !== "payload") {
    return payload;
  }

  if (!isProcessAlive(payload.payload.pid)) {
    return { status: "stale", reason: "dead pid", pid: payload.payload.pid };
  }

  const liveStartTime = await getProcessStartTime(payload.payload.pid);
  if (liveStartTime === null) {
    return { status: "stale", reason: "could not verify pid startTime", pid: payload.payload.pid };
  }

  if (liveStartTime !== payload.payload.startTime) {
    return { status: "stale", reason: "pid startTime mismatch", pid: payload.payload.pid };
  }

  if (!isProcessAlive(payload.payload.pid)) {
    return { status: "stale", reason: "dead pid", pid: payload.payload.pid };
  }

  return { status: "live", pid: payload.payload.pid };
}

async function createInternalLock(pidFile: string): Promise<InternalLockHandle> {
  let compromised: Error | null = null;
  const options: LockOptions = {
    stale: VENDOR_STALE_MS,
    retries: 0,
    onCompromised: (error) => {
      compromised = error;
    },
  };
  const release = await lock(pidFile, options);
  return {
    release,
    compromisedError: () => compromised,
  };
}

async function markForVendorStaleRecovery(pidFile: string): Promise<void> {
  const staleTime = new Date(Date.now() - VENDOR_STALE_MS - 1000);
  try {
    await utimes(lockDirPath(pidFile), staleTime, staleTime);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

async function acquireInternalLock(pidFile: string): Promise<InternalLockHandle> {
  try {
    return await createInternalLock(pidFile);
  } catch (error) {
    if (!hasErrorCode(error, "ELOCKED")) {
      throw error;
    }
  }

  const existing = await inspectExistingLock(pidFile);
  if (existing.status === "live") {
    throw makeLiveLockError(existing.pid);
  }
  if (existing.status === "possibly-live") {
    throw makePossiblyInitializingLockError(existing.reason);
  }

  const pidDescription = existing.pid === undefined ? "unknown PID" : `PID ${existing.pid}`;
  console.warn(`Reclaiming stale scaffold lock for ${pidDescription}: ${existing.reason}.`);
  await markForVendorStaleRecovery(pidFile);
  return createInternalLock(pidFile);
}

async function writeCurrentPayload(pidFile: string): Promise<void> {
  const payload: DirLockPayload = {
    pid: process.pid,
    startTime: await currentProcessStartTime(),
  };

  await writeFile(pidFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function releaseErrorIsIdempotent(error: unknown): boolean {
  return hasErrorCode(error, "ERELEASED") || hasErrorCode(error, "ENOTACQUIRED");
}

async function releaseInternal(internal: InternalLockHandle): Promise<void> {
  const compromised = internal.compromisedError();
  let releaseError: unknown;
  try {
    await internal.release();
  } catch (error) {
    if (!releaseErrorIsIdempotent(error)) {
      releaseError = error;
    }
  }

  if (compromised !== null && releaseError !== undefined) {
    throw new AggregateError([compromised, releaseError], "Failed to release compromised scaffold lock");
  }
  if (compromised !== null) {
    throw compromised;
  }
  if (releaseError !== undefined) {
    throw releaseError;
  }
}

function settleVoid(promise: Promise<void>): Promise<VoidPromiseResult> {
  return promise.then(
    () => ({ status: "fulfilled" }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

async function releaseAfterFailedPayloadWrite(internal: InternalLockHandle, writeError: unknown): Promise<never> {
  const releaseResult = await settleVoid(releaseInternal(internal));
  if (releaseResult.status === "rejected") {
    throw new AggregateError(
      [writeError, releaseResult.reason],
      "Failed to write scaffold lock payload and release lock",
      { cause: writeError },
    );
  }

  throw writeError;
}

export async function acquire(targetDir: string): Promise<DirLockHandle> {
  const pidFile = payloadPath(targetDir);
  const internal = await acquireInternalLock(pidFile);

  const writeResult = await settleVoid(writeCurrentPayload(pidFile));
  if (writeResult.status === "rejected") {
    await releaseAfterFailedPayloadWrite(internal, writeResult.reason);
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;

      let payloadError: unknown;
      try {
        await rm(pidFile, { force: true });
      } catch (error) {
        payloadError = error;
      }

      let releaseError: unknown;
      try {
        await releaseInternal(internal);
      } catch (error) {
        releaseError = error;
      }

      if (payloadError !== undefined && releaseError !== undefined) {
        throw new AggregateError([payloadError, releaseError], "Failed to delete scaffold lock payload and release lock");
      }
      if (payloadError !== undefined) {
        throw payloadError;
      }
      if (releaseError !== undefined) {
        throw releaseError;
      }
    },
  };
}
