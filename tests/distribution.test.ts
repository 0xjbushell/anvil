import { describe, expect, test } from "bun:test";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  buildBinaries,
  buildTargets,
  commandForTarget,
  entryPoint,
  outputDir,
  type BuildRunner,
} from "../scripts/build.ts";
import { collectScaffoldAssets, formatScaffoldAssetsModule } from "../scripts/generate-scaffold-assets.ts";
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

function runSteps(steps: unknown[]): string[] {
  return steps.flatMap((step) => {
    if (typeof step !== "object" || step === null || !("run" in step)) {
      return [];
    }

    const run = (step as { run?: unknown }).run;
    return typeof run === "string" ? [run] : [];
  });
}

function runStepByName(steps: unknown[], name: string): string {
  const step = steps.find((candidate) => {
    return typeof candidate === "object" && candidate !== null && (candidate as { name?: unknown }).name === name;
  });
  const run = typeof step === "object" && step !== null ? (step as { run?: unknown }).run : undefined;
  if (typeof run !== "string") {
    throw new Error(`Workflow step "${name}" does not define a run command`);
  }
  return run;
}

function workflowStepByName(steps: unknown[], name: string): Record<string, unknown> {
  const step = steps.find((candidate) => {
    return typeof candidate === "object" && candidate !== null && (candidate as { name?: unknown }).name === name;
  });
  if (typeof step !== "object" || step === null) {
    throw new Error(`Workflow step "${name}" is missing`);
  }
  return step as Record<string, unknown>;
}

function hostPlatform(): "linux" | "darwin" | "windows" {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported test platform: ${process.platform}`);
  }
}

function hostArch(): "x64" | "arm64" {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported test architecture: ${process.arch}`);
  }
}

function hostBinaryName(): string {
  const platform = hostPlatform();
  const name = `anvil-${platform}-${hostArch()}`;
  return platform === "windows" ? `${name}.exe` : name;
}

function withSourceAssetsUnavailable(root: string, operation: () => void): void {
  const movedPaths = [
    { original: path.join(root, "static"), hidden: path.join(root, `.static-unavailable-${process.pid}`) },
    {
      original: path.join(root, "src/templates"),
      hidden: path.join(root, "src", `.templates-unavailable-${process.pid}`),
    },
  ];

  try {
    for (const { original, hidden } of movedPaths) {
      renameSync(original, hidden);
    }

    operation();
  } finally {
    for (const { original, hidden } of movedPaths.reverse()) {
      if (!existsSync(original) && existsSync(hidden)) {
        renameSync(hidden, original);
      }
    }
  }
}

function copyDistributionBuildSource(destination: string): void {
  for (const entry of ["bin", "scripts", "src", "static", "package.json"] as const) {
    cpSync(path.join(repoRoot, entry), path.join(destination, entry), { recursive: true });
  }

  symlinkSync(path.join(repoRoot, "node_modules"), path.join(destination, "node_modules"), "dir");
}

function writeFakeCurl(binDir: string): void {
  const curlPath = path.join(binDir, "curl");
  writeFileSync(
    curlPath,
    `#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      shift
      output="$1"
      ;;
    -*)
      ;;
    *)
      url="$1"
      ;;
  esac
  shift
done

printf '%s' "$url" > "$ANVIL_CAPTURE_URL"
if [ "\${ANVIL_FAKE_CURL_FAIL:-0}" = "1" ]; then
  echo "mock missing release asset" >&2
  exit 22
fi

printf '#!/usr/bin/env sh\\nexit 0\\n' > "$output"
`,
    "utf8",
  );
  chmodSync(curlPath, 0o755);
}

function runInstall(version: string, options: { failDownload?: boolean } = {}): {
  result: SpawnSyncReturns<string>;
  capturedUrl: string;
  installDir: string;
  workspace: string;
} {
  const workspace = mkdtempSync(path.join(tmpdir(), "anvil-install-"));
  const binDir = path.join(workspace, "bin");
  const installDir = path.join(workspace, "install");
  const capturePath = path.join(workspace, "url");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });
  writeFakeCurl(binDir);

  const result = spawnSync("bash", [path.join(repoRoot, "scripts/install.sh")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      ANVIL_CAPTURE_URL: capturePath,
      ANVIL_INSTALL_DIR: installDir,
      ANVIL_VERSION: version,
      ...(options.failDownload === true ? { ANVIL_FAKE_CURL_FAIL: "1" } : {}),
    },
    timeout: 30_000,
  });

  return {
    result,
    capturedUrl: existsSync(capturePath) ? readFileSync(capturePath, "utf8") : "",
    installDir,
    workspace,
  };
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

  test("embedded scaffold assets match the source scaffold trees", async () => {
    expect(read("src/generated/scaffold-assets.ts")).toBe(
      formatScaffoldAssetsModule(await collectScaffoldAssets(repoRoot)),
    );
  });

  test(
    "bun run build produces standalone binaries and the host binary scaffolds outside the repo",
    () => {
      const buildRoot = mkdtempSync(path.join(tmpdir(), "anvil dist source "));
      copyDistributionBuildSource(buildRoot);

      const distDir = path.join(buildRoot, outputDir);

      const build = spawnSync(bunExecutable, ["run", "build"], {
        cwd: buildRoot,
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

      const hostBinaryPath = path.join(distDir, hostBinaryName());
      const runDir = mkdtempSync(path.join(tmpdir(), "anvil dist run "));
      const copiedBinary = path.join(runDir, hostBinaryName());
      try {
        copyFileSync(hostBinaryPath, copiedBinary);
        if (process.platform !== "win32") {
          chmodSync(copiedBinary, 0o755);
        }

        withSourceAssetsUnavailable(buildRoot, () => {
          for (const { lang, files } of [
            { lang: "typescript", files: ["package.json", "src/seed/seed.ts", ".anvil.lock"] },
            { lang: "golang", files: ["go.mod", "internal/seed/seed.go", ".anvil.lock"] },
            { lang: "python", files: ["pyproject.toml", "src/seed/seed.py", ".anvil.lock"] },
          ] as const) {
            const projectDir = path.join(runDir, `${lang} project`);
            mkdirSync(projectDir, { recursive: true });

            const scaffold = spawnSync(copiedBinary, ["init", "--lang", lang, "--non-interactive"], {
              cwd: projectDir,
              encoding: "utf8",
              timeout: distributionTimeoutMs,
            });
            expectSuccess(scaffold, `standalone binary scaffold ${lang}`);

            for (const file of files) {
              expect(existsSync(path.join(projectDir, file))).toBe(true);
            }
          }
        });
      } finally {
        rmSync(runDir, { recursive: true, force: true });
        rmSync(buildRoot, { recursive: true, force: true });
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

  test("install script resolves latest and pinned release asset URLs for the host platform", () => {
    const scriptPath = path.join(repoRoot, "scripts/install.sh");
    const script = read("scripts/install.sh");
    const syntax = spawnSync("bash", ["-n", scriptPath], { cwd: repoRoot, encoding: "utf8" });

    expect(syntax.status).toBe(0);
    expect(script.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n")).toBe(true);
    expect(script).toContain("ANVIL_VERSION:-latest");
    expect(script).toContain("ANVIL_INSTALL_DIR:-/usr/local/bin");
    expect(script).toContain("x86_64|amd64");
    expect(script).toContain("aarch64|arm64");
    expect(script).toContain('OS="windows"');
    expect(script).toContain('ASSET="${ASSET}.exe"');
    expect(statSync(scriptPath).mode & 0o111).toBeTruthy();

    const installs = [runInstall("latest"), runInstall("v1.2.3")];
    try {
      const [latest, pinned] = installs;
      expectSuccess(latest.result, "install latest");
      expect(latest.capturedUrl).toBe(
        `https://github.com/0xjbushell/anvil/releases/latest/download/${hostBinaryName()}`,
      );
      expect(existsSync(path.join(latest.installDir, process.platform === "win32" ? "anvil.exe" : "anvil"))).toBe(true);

      expectSuccess(pinned.result, "install pinned");
      expect(pinned.capturedUrl).toBe(
        `https://github.com/0xjbushell/anvil/releases/download/v1.2.3/${hostBinaryName()}`,
      );
    } finally {
      for (const install of installs) {
        rmSync(install.workspace, { recursive: true, force: true });
      }
    }
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

  test("install script reports missing release assets without installing success-shaped output", () => {
    const install = runInstall("v1.2.3", { failDownload: true });
    try {
      expect(install.result.status).toBe(1);
      expect(install.capturedUrl).toBe(`https://github.com/0xjbushell/anvil/releases/download/v1.2.3/${hostBinaryName()}`);
      expect(install.result.stderr).toContain("Failed to download anvil release asset");
      expect(install.result.stderr).toContain(install.capturedUrl);
      expect(install.result.stdout).not.toContain("anvil installed");
    } finally {
      rmSync(install.workspace, { recursive: true, force: true });
    }
  });

  test("release workflow builds, verifies, and uploads every binary asset", () => {
    const workflow = parseYaml(read(".github/workflows/release.yml"));
    const steps = workflow?.jobs?.release?.steps ?? [];
    const commands = runSteps(steps);
    const joinedCommands = commands.join("\n");
    const resolveAssetTagStep = workflowStepByName(steps, "Resolve release asset tag");
    const uploadAssetsStep = workflowStepByName(steps, "Upload release assets");
    const uploadCommand = runStepByName(steps, "Upload release assets");

    expect(workflow?.on?.workflow_dispatch?.inputs?.release_tag).toMatchObject({
      required: true,
    });
    expect(steps[0]).toMatchObject({
      id: "release",
      uses: "googleapis/release-please-action@v4",
    });
    expect(steps.some((step: { uses?: string }) => step.uses === "actions/checkout@v4")).toBe(true);
    expect(steps.some((step: { uses?: string }) => step.uses === "cachix/install-nix-action@v31")).toBe(true);
    expect(steps.some((step: { uses?: string }) => step.uses === "oven-sh/setup-bun@v2")).toBe(true);
    expect(steps.some((step: { id?: string }) => step.id === "asset-tag")).toBe(true);
    expect(resolveAssetTagStep.env).toMatchObject({
      GH_REPO: "${{ github.repository }}",
    });
    expect(uploadAssetsStep.env).toMatchObject({
      GH_REPO: "${{ github.repository }}",
    });
    expect(joinedCommands).toContain('if [ "$EVENT_NAME" = "workflow_dispatch" ]; then');
    expect(joinedCommands).toContain('gh release view "$DISPATCH_RELEASE_TAG" --repo "$GH_REPO"');
    expect(joinedCommands).toContain('No release assets to upload for this main push.');
    expect(joinedCommands).toContain("scripts/nix-run.sh release -- bun install --frozen-lockfile");
    expect(joinedCommands).toContain("scripts/nix-run.sh release -- scripts/require-tools.sh release");
    expect(joinedCommands).toContain("bun run build");
    expect(joinedCommands).not.toContain("scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun run build");
    expect(uploadCommand).toContain('gh release upload "${{ steps.asset-tag.outputs.tag }}"');
    expect(uploadCommand).toContain('--repo "$GH_REPO"');
    expect(uploadCommand).toContain("--clobber");
    expect(joinedCommands).toContain('grep -a -q "/nix/store" "$asset"');
    expect(joinedCommands).toContain("rebuild release assets with portable Bun before publishing");
    expect(joinedCommands).toContain("dist/anvil-linux-x64 --version");
    expect(joinedCommands).toContain('for lang in typescript golang python; do');
    expect(joinedCommands).toContain('init --lang "$lang" --non-interactive');
    expect(joinedCommands).toContain('.anvil.lock');
    expect(
      steps.filter((step: { if?: string }) => step.if === "${{ steps.asset-tag.outputs.tag != '' }}"),
    ).toHaveLength(7);
    expect(steps.filter((step: { if?: string }) => step.if === "${{ steps.release.outputs.release_created == 'true' }}")).toHaveLength(0);

    const checkout = steps.find((step: { uses?: string }) => step.uses === "actions/checkout@v4");
    expect(checkout).toMatchObject({
      with: {
        ref: "${{ steps.asset-tag.outputs.tag }}",
      },
    });

    for (const target of buildTargets) {
      const assetPath = `dist/${target.outfile}`;
      expect(joinedCommands).toContain(`test -s "${assetPath}"`);
      expect(joinedCommands).toContain(assetPath);
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
