---
title: Installation
description: Install or run Anvil with Bun or standalone release binaries.
---

The primary path is Bun:

```bash
bunx anvil init --lang typescript
```

This is the simplest path for TypeScript/JavaScript projects and any environment where Bun is already available.

## Standalone binaries

Standalone binaries are published on the [GitHub Releases](https://github.com/0xjbushell/anvil/releases) page for users who do not want Bun in the target environment.

The repository installer lives at `scripts/install.sh` and can be run directly:

```bash
curl -fsSL https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh | bash
```

It detects `linux`, `darwin`, or `windows`, plus `x64` or `arm64`, then downloads the matching asset:

```text
https://github.com/0xjbushell/anvil/releases/latest/download/anvil-<os>-<arch>
https://github.com/0xjbushell/anvil/releases/download/<version>/anvil-<os>-<arch>
```

For Windows, the asset and installed binary use the `.exe` suffix.

## Pin a version or install directory

Use `ANVIL_VERSION` for a release tag and `ANVIL_INSTALL_DIR` for the destination:

```bash
ANVIL_VERSION=v0.2.0 ANVIL_INSTALL_DIR="$HOME/.local/bin" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh)"
```

If `ANVIL_VERSION` is unset, the installer resolves `latest`.
