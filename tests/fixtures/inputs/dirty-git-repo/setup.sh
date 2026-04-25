#!/usr/bin/env sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
if [ ! -d .git ]; then
  git init --quiet --initial-branch=main
  git -c user.email=ci@anvil -c user.name=anvil-fixtures commit --allow-empty -q -m "init"
fi
echo "uncommitted readme content $(date +%s)" > README.md
