#!/usr/bin/env sh
set -eu

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install hooks" >&2
  exit 1
fi

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

if [ ! -d .husky ]; then
  echo "missing .husky directory" >&2
  exit 1
fi

git config core.hooksPath .husky

for hook in .husky/*; do
  [ -f "$hook" ] || continue
  chmod +x "$hook"
done

echo "Git hooks installed from .husky"
