#!/usr/bin/env sh
set -eu

: "${ANVIL_BIN:?ANVIL_BIN is required by re-scaffold fixtures}"
ANVIL_BUN="${ANVIL_BUN:-bun}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

if [ ! -f .anvil.lock ]; then
  "$ANVIL_BUN" "$ANVIL_BIN" init --lang typescript --non-interactive
fi

cat >Makefile <<'MAKEFILE'
PKG_EXEC ?= bunx

.PHONY: lint format typecheck test

lint:
	$(PKG_EXEC) eslint .

format:
	$(PKG_EXEC) prettier --check .

typecheck:
	$(PKG_EXEC) tsc --noEmit

test:
	$(PKG_EXEC) vitest run
MAKEFILE

"$ANVIL_BUN" --eval '
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");

const lock = JSON.parse(readFileSync(".anvil.lock", "utf8"));
const checksum = `sha256:${createHash("sha256").update(readFileSync("Makefile")).digest("hex")}`;

lock.version = "0.0.1";
lock.files = lock.files.map((entry) =>
  entry.path === "Makefile" ? { ...entry, checksum, status: "written" } : entry,
);
lock.createdAt = "2025-01-01T00:00:00.000Z";
lock.updatedAt = "2025-01-01T00:00:00.000Z";

writeFileSync(".anvil.lock", `${JSON.stringify(lock, null, 2)}\n`);
'
