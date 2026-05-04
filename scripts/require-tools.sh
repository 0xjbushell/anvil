#!/usr/bin/env sh
set -eu

usage() {
  echo "usage: scripts/require-tools.sh <default|release> [--] [command] [args...]" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 64
fi

profile=$1
shift

default_tools="bun node node-gyp python3 gcc g++ make git"

case "$profile" in
  default)
    required_tools=$default_tools
    ;;
  release)
    required_tools="$default_tools go uv gitleaks govulncheck golangci-lint staticcheck deadcode"
    ;;
  *)
    echo "unknown tool profile \"$profile\"; expected default or release" >&2
    exit 64
    ;;
esac

missing_tools=""
for tool in $required_tools; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing_tools="$missing_tools $tool"
  fi
done

if [ -n "$missing_tools" ]; then
  echo "Anvil $profile validation environment is missing required tools (D-71/D-72):" >&2
  for tool in $missing_tools; do
    echo "- $tool" >&2
  done
  echo "Enter the Nix shell through scripts/nix-run.sh so supported-language validation hard-fails instead of skipping." >&2
  exit 127
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  exit 0
fi

exec "$@"
