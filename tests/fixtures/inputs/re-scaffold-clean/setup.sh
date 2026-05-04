#!/usr/bin/env sh
set -eu

: "${ANVIL_BIN:?ANVIL_BIN is required by re-scaffold fixtures}"
ANVIL_BUN="${ANVIL_BUN:-bun}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

if [ ! -f .anvil.lock ]; then
  "$ANVIL_BUN" "$ANVIL_BIN" init --lang typescript --non-interactive
fi
