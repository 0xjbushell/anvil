# Vendored: proper-lockfile

## Source
- Upstream: https://github.com/moxystudio/node-proper-lockfile
- Pinned version: v4.1.2 (ported from `lib/lockfile.js` at that tag)
- License: MIT (see ./LICENSE)

## Public API
- `lock(file, options?)` → `Promise<release>` where `release: () => Promise<void>`
- `unlock(file)` → `Promise<void>`
- `check(file)` → `Promise<boolean>`

All async. No sync variants.

## Path convention (load-bearing — do not "fix")

`lock(file)` does **not** take a lock *on* `file`. It atomically creates a
sibling directory at `<file>.lock/`. The file at `path` is never touched by
the lock primitive — callers read/write `file` themselves.

This matches upstream `proper-lockfile`. Callers (e.g. the scaffold engine)
reason about the two paths as separate filesystem entries; "fixing" the API
into something where the lock and the file share a path will silently break
those callers.

Locking a path that itself ends in `.lock` is allowed and produces
`<file>.lock.lock/`.

## What we kept
- `mkdir`-based atomic acquisition (mkdir is atomic on POSIX; fails with
  `EEXIST` if the directory already exists).
- Stale lock detection via mtime + configurable `stale` threshold
  (default 10000ms, floored at 2000ms — same as upstream).
- Retry policy with exponential backoff (upstream defaults:
  `{ retries: 0, factor: 2, minTimeout: 1000, maxTimeout: Infinity, randomize: true }`,
  and `retries` may be passed as a plain number).
- Periodic mtime refresh while the lock is held (`update` interval, default
  `stale / 2`, clamped to `[1000, stale/2]`). The refresh timer is `unref`ed.
- `unlock` semantics: throws `ENOTACQUIRED` if you don't hold the lock.
  Removing the on-disk lock dir afterwards is idempotent (`ENOENT` ignored).
- `ECOMPROMISED` signalling when the lock dir disappears or its mtime is
  changed by something else mid-hold; surfaced via the `onCompromised`
  callback (default: re-throw).
- Error codes mirror upstream: `ELOCKED`, `ENOTACQUIRED`, `ECOMPROMISED`,
  `ERELEASED`.

## What we dropped (with rationale)
- `graceful-fs` adapter — `node:fs/promises` is sufficient for our use; we
  do not run on EMFILE-prone fleets.
- `signal-exit` exit-handler that removes locks on process exit — not needed
  for our short-lived CLI; stale detection covers crash recovery. (Documented
  divergence.)
- `realpath` resolution — we normalise via `path.resolve(file)` only.
  Symlinks pointing at the same file will produce distinct in-memory lock
  entries. Anvil never locks through symlinks, so this is acceptable.
  (Documented divergence.)
- `mtime-precision` probe — we use the mtime returned by `fs.stat` after
  `mkdir`, with no probing. Modern filesystems (ext4, APFS, NTFS) all
  support millisecond-or-better mtime granularity, which is well below the
  2000 ms minimum stale window.
- Sync API (`lockSync` / `unlockSync` / `checkSync`) — we only call this
  from async code.
- CLI wrapper / `bin` entry — not needed.
- Legacy Windows symlink workarounds — modern Node/Bun handle this fine.

## Tests
```
bun test src/internal/lockfile/
```

## Known reclaim race (matches upstream)

When two processes simultaneously detect the same stale lock, the
sequence `stat → isStale → rmdir → mkdir` in one process can race with
the other process's `stat`, which still sees the original stale mtime
and proceeds to `rmdir` the *just-acquired* fresh lock. Outcome: both
processes briefly believe they hold the lock until the periodic
`refreshLock` tick (≤ `stale/2`, ≥ 1000 ms) detects the mtime mismatch
and fires `ECOMPROMISED`.

This is **inherent to mkdir-based stale reclaim** and matches upstream
`proper-lockfile`'s behavior — it is not a vendoring regression. The
race is bounded by the refresh interval; with `retries: 0` (the default)
no caller is exposed to it. Callers that opt into `retries > 0` for
operations across this primitive must either:

1. Make those operations idempotent across the race window (e.g. anvil's
   D-70 lockfile-as-checkpoint design — file flushes are content-addressed
   and re-runnable), or
2. Treat `ECOMPROMISED` from `onCompromised` / a returned `release` as a
   signal to abort the critical section.

If you need a concurrency primitive without this race, a higher-level
solution (advisory file locks, an OS mutex, or a database) is required —
that decision is outside the scope of this vendored library.
