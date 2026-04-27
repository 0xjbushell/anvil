#!/usr/bin/env bash
set -euo pipefail

VERSION="${ANVIL_VERSION:-latest}"
if [[ ! "$VERSION" =~ ^(latest|v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
  echo "Invalid ANVIL_VERSION: use 'latest' or a vX.Y.Z release tag" >&2
  exit 1
fi

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m | tr '[:upper:]' '[:lower:]')"

case "$OS" in
  linux)
    OS="linux"
    ;;
  darwin)
    OS="darwin"
    ;;
  mingw*|msys*|cygwin*|windows*)
    OS="windows"
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

ASSET="anvil-${OS}-${ARCH}"
DEST_NAME="anvil"
if [ "$OS" = "windows" ]; then
  ASSET="${ASSET}.exe"
  DEST_NAME="anvil.exe"
fi

URL="https://github.com/0xjbushell/anvil/releases/download/${VERSION}/${ASSET}"
INSTALL_DIR="${ANVIL_INSTALL_DIR:-/usr/local/bin}"
DEST="${INSTALL_DIR}/${DEST_NAME}"
TMP="$(mktemp)"

cleanup() {
  if [ -n "${TMP:-}" ]; then
    rm -f "$TMP"
  fi
}
trap cleanup EXIT

curl -fsSL "$URL" -o "$TMP"
chmod +x "$TMP"
mkdir -p "$INSTALL_DIR"
mv "$TMP" "$DEST"
TMP=""

echo "anvil installed to $DEST"
