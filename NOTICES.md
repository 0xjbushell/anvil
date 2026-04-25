# Notices

Anvil vendors a small number of third-party libraries directly into
`src/internal/` per [D-67 §Part C](specs/decisions/anvil-decisions.md). Each
vendored package is listed below with its upstream source, the version that
was used as the canonical reference, its license, and the path in this repo.

The full upstream license text for each package is preserved at
`<vendored-path>/LICENSE`.

---

### proper-lockfile

- Source: https://github.com/moxystudio/node-proper-lockfile
- Version: v4.1.2 (ported from `lib/lockfile.js` at that tag)
- License: MIT (full text at [src/internal/lockfile/LICENSE](src/internal/lockfile/LICENSE))
- Vendored at: [src/internal/lockfile/](src/internal/lockfile/)
- Notes: Trimmed to async-only API. The `graceful-fs` adapter, the
  `signal-exit` exit-handler, the `realpath` resolution, the
  `mtime-precision` probe, and the sync API (`lockSync` / `unlockSync` /
  `checkSync`) were dropped. See
  [src/internal/lockfile/README.md](src/internal/lockfile/README.md) for
  full divergence notes and the documented mkdir-stale-reclaim race window
  (which matches upstream behavior).

### dir-compare

- Source: https://github.com/gliviu/dir-compare
- Version: v5.0.0 (used as public-API reference; see notes below)
- License: MIT (full text at [src/internal/dir-compare/LICENSE](src/internal/dir-compare/LICENSE))
- Vendored at: [src/internal/dir-compare/](src/internal/dir-compare/)
- Notes: This is a **clean-room reimplementation against the v5.0.0 public
  API**, not a port of upstream source. Anvil only exercises the async
  walker with three comparison modes (name / size / content) and a `filter`
  callback; reimplementing that slice as ~240 LOC satisfies D-67 §Part C's
  goal — *"trimmed code small enough to read end-to-end in a code review"* —
  better than a heavily trimmed verbatim copy. Attribution to upstream
  authors (Liviu Grigorescu and contributors) is preserved here and in
  [src/internal/dir-compare/LICENSE](src/internal/dir-compare/LICENSE);
  see [src/internal/dir-compare/README.md](src/internal/dir-compare/README.md)
  for the full rationale.
