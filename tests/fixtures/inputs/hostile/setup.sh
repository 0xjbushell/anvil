#!/usr/bin/env sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
printf "999999\n" > .anvil.lock.pid
printf "hostile setup applied\n" > setup-applied.txt
# Ensure readonly.txt is writable before we rewrite it (idempotency on re-run).
[ -e readonly.txt ] && chmod u+w readonly.txt
echo "intentionally unwritable text" > readonly.txt
chmod 0400 readonly.txt
