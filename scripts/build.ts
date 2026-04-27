#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";

export const entryPoint = "src/cli.ts";
export const outputDir = "dist";

export const buildTargets = [
  { triple: "bun-linux-x64", outfile: "anvil-linux-x64" },
  { triple: "bun-linux-arm64", outfile: "anvil-linux-arm64" },
  { triple: "bun-darwin-x64", outfile: "anvil-darwin-x64" },
  { triple: "bun-darwin-arm64", outfile: "anvil-darwin-arm64" },
  { triple: "bun-windows-x64", outfile: "anvil-windows-x64.exe" },
] as const;

export type BuildTarget = (typeof buildTargets)[number];
export type BuildRunner = (command: readonly string[]) => Promise<void>;

export function commandForTarget(target: BuildTarget): string[] {
  return [
    "bun",
    "build",
    "--compile",
    "--reject-unresolved",
    `--target=${target.triple}`,
    entryPoint,
    "--outfile",
    `${outputDir}/${target.outfile}`,
  ];
}

async function runCommand(command: readonly string[]): Promise<void> {
  const proc = Bun.spawn([...command], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Build command failed with exit code ${exitCode}: ${command.join(" ")}`);
  }
}

export async function buildBinaries({
  mkdirp = async (directory: string) => {
    await mkdir(directory, { recursive: true });
  },
  runner = runCommand,
}: {
  mkdirp?: (directory: string) => Promise<void>;
  runner?: BuildRunner;
} = {}): Promise<void> {
  await mkdirp(outputDir);

  for (const target of buildTargets) {
    await runner(commandForTarget(target));
  }
}

if (import.meta.main) {
  await buildBinaries();
}
