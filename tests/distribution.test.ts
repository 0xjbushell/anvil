import { describe, expect, test } from "bun:test";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildBinaries,
  buildTargets,
  commandForTarget,
  entryPoint,
  outputDir,
  type BuildRunner,
} from "../scripts/build.ts";
import pkg from "../package.json" with { type: "json" };

const repoRoot = path.join(import.meta.dir, "..");
const bunExecutable = "bun" in process.versions ? process.execPath : "bun";
const distributionTimeoutMs = 180_000;

interface PackageJson {
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
}

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function packageJson(): PackageJson {
  return JSON.parse(read("package.json")) as PackageJson;
}

function installationSection(): string {
  const readme = read("README.md");
  const heading = "## Installation\n";
  const start = readme.indexOf(heading);
  if (start === -1) {
    throw new Error("README.md is missing an Installation section");
  }

  const bodyStart = start + heading.length;
  const nextHeading = readme.indexOf("\n## ", bodyStart);
  return nextHeading === -1 ? readme.slice(bodyStart) : readme.slice(bodyStart, nextHeading);
}

function expectSuccess(result: SpawnSyncReturns<string>, label: string): void {
  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function hostBinaryName(): string | null {
  const platform =
    process.platform === "linux"
      ? "linux"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform === "win32"
          ? "windows"
          : null;
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (platform === null || arch === null) {
    return null;
  }

  return platform === "windows" ? `anvil-${platform}-${arch}.exe` : `anvil-${platform}-${arch}`;
}

describe("TIX-000027 distribution", () => {
  test("package metadata exposes Bun entrypoint and publishable files without Node engines", () => {
    const pkg = packageJson();

    expect(pkg.bin?.anvil).toBe("./bin/anvil.ts");
    expect(read("bin/anvil.ts").startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(pkg.files).toEqual(["bin", "src", "static", "README.md", "LICENSE"]);
    expect(pkg.scripts?.build).toBe("bun run scripts/build.ts");
    expect(pkg.scripts?.prepublishOnly).toBe("bun test && bun run build");
    expect(pkg.engines?.node).toBeUndefined();
  });

  test("build script defines five standalone binary targets", () => {
    expect(entryPoint).toBe("src/cli.ts");
    expect(outputDir).toBe("dist");
    expect(buildTargets).toEqual([
      { triple: "bun-linux-x64", outfile: "anvil-linux-x64" },
      { triple: "bun-linux-arm64", outfile: "anvil-linux-arm64" },
      { triple: "bun-darwin-x64", outfile: "anvil-darwin-x64" },
      { triple: "bun-darwin-arm64", outfile: "anvil-darwin-arm64" },
      { triple: "bun-windows-x64", outfile: "anvil-windows-x64.exe" },
    ]);
  });

  test("build script compiles each target into dist", async () => {
    const commands: string[][] = [];
    const mkdirs: string[] = [];
    const runner: BuildRunner = async (command) => {
      commands.push([...command]);
    };

    await buildBinaries({
      mkdirp: async (directory) => {
        mkdirs.push(directory);
      },
      runner,
    });

    expect(mkdirs).toEqual([outputDir]);
    expect(commands).toEqual(buildTargets.map((target) => commandForTarget(target)));
  });

  test(
    "bun run build produces standalone binaries and the host binary reports version",
    () => {
      const distDir = path.join(repoRoot, outputDir);
      rmSync(distDir, { recursive: true, force: true });

      const build = spawnSync(bunExecutable, ["run", "build"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: distributionTimeoutMs,
      });
      expectSuccess(build, "bun run build");

      expect(readdirSync(distDir).sort()).toEqual(buildTargets.map((target) => target.outfile).sort());
      for (const target of buildTargets) {
        const binaryPath = path.join(distDir, target.outfile);
        const stats = statSync(binaryPath);
        expect(stats.size).toBeGreaterThan(0);
        if (!target.outfile.endsWith(".exe")) {
          expect(stats.mode & 0o111).toBeTruthy();
        }
      }

      const hostBinary = hostBinaryName();
      expect(hostBinary).not.toBeNull();
      const runDir = mkdtempSync(path.join(tmpdir(), "anvil-dist-run-"));
      try {
        const run = spawnSync(path.join(distDir, hostBinary as string), ["--version"], {
          cwd: runDir,
          encoding: "utf8",
          timeout: 30_000,
        });
        expectSuccess(run, "standalone binary --version");
        expect(run.stdout.trim()).toBe(pkg.version);
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    },
    distributionTimeoutMs,
  );

  test("bun x package entrypoint reports version from outside the repo", () => {
    const cleanDir = mkdtempSync(path.join(tmpdir(), "anvil-bunx-"));
    try {
      mkdirSync(path.join(cleanDir, "node_modules/.bin"), { recursive: true });
      symlinkSync(repoRoot, path.join(cleanDir, "node_modules/anvil"), "dir");
      symlinkSync("../anvil/bin/anvil.ts", path.join(cleanDir, "node_modules/.bin/anvil"));

      const run = spawnSync(bunExecutable, ["x", "--bun", "--no-install", "anvil", "--version"], {
        cwd: cleanDir,
        encoding: "utf8",
        timeout: 30_000,
      });

      expectSuccess(run, "bun x anvil --version");
      expect(run.stdout.trim()).toBe(pkg.version);
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  test("install script downloads the release binary for the host platform", () => {
    const scriptPath = path.join(repoRoot, "scripts/install.sh");
    const script = read("scripts/install.sh");
    const syntax = spawnSync("bash", ["-n", scriptPath], { cwd: repoRoot, encoding: "utf8" });

    expect(syntax.status).toBe(0);
    expect(script.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n")).toBe(true);
    expect(script).toContain("ANVIL_VERSION:-latest");
    expect(script).toContain("ANVIL_INSTALL_DIR:-/usr/local/bin");
    expect(script).toContain("https://github.com/0xjbushell/anvil/releases/download/${VERSION}/${ASSET}");
    expect(script).toContain("x86_64|amd64");
    expect(script).toContain("aarch64|arm64");
    expect(script).toContain('OS="windows"');
    expect(script).toContain('ASSET="${ASSET}.exe"');
    expect(statSync(scriptPath).mode & 0o111).toBeTruthy();
  });

  test("install script rejects invalid release versions before download", () => {
    const installDir = mkdtempSync(path.join(tmpdir(), "anvil-install-"));
    try {
      const result = spawnSync("bash", [path.join(repoRoot, "scripts/install.sh")], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ANVIL_INSTALL_DIR: installDir,
          ANVIL_VERSION: "../../bad",
        },
        timeout: 30_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid ANVIL_VERSION");
      expect(result.stdout).not.toContain("anvil installed");
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });

  test("README documents only Bun and standalone installation paths", () => {
    const install = installationSection();

    expect(install).toContain("bunx anvil init --lang typescript");
    expect(install).toContain("curl -fsSL https://anvil.sh/install.sh | sh");
    expect(install).not.toContain("npx");
    expect(install).not.toContain("npm install -g");
  });

  test("distribution build artifacts are ignored", () => {
    expect(read(".gitignore")).toContain("dist/");
  });
});
