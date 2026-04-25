# Vendored: dir-compare

## Source
- Upstream: https://github.com/gliviu/dir-compare
- API reference tag: v5.0.0
- License: MIT (see ./LICENSE)

## Implementation note — clean-room reimplementation
This is a **from-scratch reimplementation against the public API documented
below**, not a port of upstream source. The upstream repo at the v5.0.0 tag was
read end-to-end as the API contract, but no upstream file was copied into this
directory.

Rationale: upstream's multi-mode machinery spans ~30 files (sync + async, line
comparators, hash comparators, glob helpers, pretty printers, statistics
aggregation). Anvil only exercises a small slice — the async walker with three
comparison modes (name / size / content) and a `filter` callback. Reimplementing
that slice as 240 LOC satisfies D-67 §Part C's stated goal — *"trimmed code
small enough to read end-to-end in a code review"* — better than a heavily
trimmed verbatim copy would: there is no dead-code residue to mislead future
readers about which paths anvil actually exercises, and the supply-chain attack
surface (the ultimate driver of D-67 §Part C) is reduced further.

Future maintainers: do **not** diff this implementation against upstream and
reconcile. Upstream is the public-API reference; this file tree is the source
of truth for our slice. Attribution lives in the top-level `NOTICES.md`.

## Public API
- `compare(left, right, options?) → Promise<Result>`
- Types: `Result`, `DiffEntry`, `CompareOptions`

## API surface in scope
- Async recursive walker
- name-only / size / content comparison modes
- `filter` callback (applied at walk time, both sides)

## API surface intentionally excluded
- All sync entry points (`compareSync`, etc.) — async only
- CLI wrapper / bin
- Glob/pattern helpers (the `filter` callback covers our needs)
- Custom error formatters / pretty printers (caller's job)
- Hash-based content comparators — direct byte comparison via `Buffer.equals` is
  sufficient for the scale of inputs we compare (scaffold output trees, not
  gigabyte directories)

## Symlink behavior
Follows symlinks by default (uses `stat`, not `lstat`). Matches upstream default.

## Size-only mode is a heuristic
With `compareSize: true, compareContent: false`, two files with identical size
but different content are reported as `equal` (the content is never read). Use
`compareContent: true` for byte-exact equality. Without any flag the comparison
is name-only — files with the same name on both sides are reported as equal
regardless of size or content.

## Tests
```
bun test src/internal/dir-compare/
```
