#!/usr/bin/env sh
set -eu

usage() {
  echo "usage: scripts/nix-run.sh <default|release> [--] <command> [args...]" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 64
fi

env_name=$1
shift

case "$env_name" in
  default | release) ;;
  *)
    echo "unknown Nix environment \"$env_name\"; expected default or release" >&2
    exit 64
    ;;
esac

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  usage
  exit 64
fi

nix_bin=${ANVIL_NIX_BIN:-nix}

if ! command -v "$nix_bin" >/dev/null 2>&1; then
  echo "Nix is required to run Anvil validation wrappers (D-72)." >&2
  echo "Install Nix, then rerun this command so validation tools are provisioned instead of skipped." >&2
  exit 127
fi

case "$0" in
  */*) script_dir=${0%/*} ;;
  *) script_dir=. ;;
esac

repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
cd "$repo_root"

exec "$nix_bin" --extra-experimental-features "nix-command flakes" develop ".#$env_name" --command "$@"
