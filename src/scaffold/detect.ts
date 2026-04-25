import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";

import type { Lang, PackageManager } from "../types.ts";

export interface DetectionResult {
  hasCode: boolean;
  sourceDir?: string;
  packageManager?: PackageManager;
}

const normalFilesystemErrorCodes = new Set(["EACCES", "ELOOP", "ENOENT", "ENOTDIR", "EPERM"]);
const typescriptSourceDirs = ["src", "lib", "app"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNormalFilesystemError(error: unknown): boolean {
  return isRecord(error) && typeof error.code === "string" && normalFilesystemErrorCodes.has(error.code);
}

async function pathStats(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath);
  } catch (error) {
    if (isNormalFilesystemError(error)) {
      return null;
    }

    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  return (await pathStats(filePath))?.isFile() ?? false;
}

async function directoryExists(directoryPath: string): Promise<boolean> {
  return (await pathStats(directoryPath))?.isDirectory() ?? false;
}

async function readDirectory(directoryPath: string): Promise<Dirent[] | null> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNormalFilesystemError(error)) {
      return null;
    }

    throw error;
  }
}

async function hasMatchingFile(
  directoryPath: string,
  matchesFile: (fileName: string) => boolean,
  skipDirectories: ReadonlySet<string>,
): Promise<boolean> {
  const entries = await readDirectory(directoryPath);
  if (!entries) {
    return false;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (skipDirectories.has(entry.name)) {
        continue;
      }

      if (await hasMatchingFile(entryPath, matchesFile, skipDirectories)) {
        return true;
      }

      continue;
    }

    if (entry.isFile() && matchesFile(entry.name)) {
      return true;
    }
  }

  return false;
}

async function findTypeScriptSourceDir(targetDir: string): Promise<string | undefined> {
  for (const sourceDir of typescriptSourceDirs) {
    if (await directoryExists(path.join(targetDir, sourceDir))) {
      return sourceDir;
    }
  }

  return undefined;
}

async function detectTypeScriptPackageManager(targetDir: string): Promise<PackageManager | undefined> {
  const candidates: Array<{ packageManager: PackageManager; lockfiles: string[] }> = [
    { packageManager: "bun", lockfiles: ["bun.lock", "bun.lockb"] },
    { packageManager: "npm", lockfiles: ["package-lock.json"] },
    { packageManager: "pnpm", lockfiles: ["pnpm-lock.yaml"] },
    { packageManager: "yarn", lockfiles: ["yarn.lock"] },
  ];

  for (const candidate of candidates) {
    for (const lockfile of candidate.lockfiles) {
      if (await fileExists(path.join(targetDir, lockfile))) {
        return candidate.packageManager;
      }
    }
  }

  return undefined;
}

function hasNonEmptyObjectProperty(value: unknown, propertyName: "dependencies" | "devDependencies"): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const property = value[propertyName];
  return isRecord(property) && Object.keys(property).length > 0;
}

async function packageJsonHasDependencies(targetDir: string): Promise<boolean> {
  const packageJsonPath = path.join(targetDir, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return false;
  }

  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch (error) {
    if (isNormalFilesystemError(error)) {
      return false;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return false;
    }

    throw error;
  }

  return hasNonEmptyObjectProperty(parsed, "dependencies") || hasNonEmptyObjectProperty(parsed, "devDependencies");
}

async function detectTypeScriptProject(targetDir: string): Promise<DetectionResult> {
  const sourceDir = await findTypeScriptSourceDir(targetDir);
  const [hasSourceFile, hasPackageDependencies, packageManager] = await Promise.all([
    hasMatchingFile(targetDir, (fileName) => [".ts", ".js"].includes(path.extname(fileName)), new Set(["node_modules"])),
    packageJsonHasDependencies(targetDir),
    detectTypeScriptPackageManager(targetDir),
  ]);

  return {
    hasCode: hasSourceFile || hasPackageDependencies || sourceDir !== undefined,
    ...(sourceDir !== undefined ? { sourceDir } : {}),
    ...(packageManager !== undefined ? { packageManager } : {}),
  };
}

async function detectGoProject(targetDir: string): Promise<DetectionResult> {
  const [hasGoFile, hasGoMod] = await Promise.all([
    hasMatchingFile(targetDir, (fileName) => path.extname(fileName) === ".go", new Set(["vendor"])),
    fileExists(path.join(targetDir, "go.mod")),
  ]);

  return {
    hasCode: hasGoFile || hasGoMod,
  };
}

async function detectPythonProject(targetDir: string): Promise<DetectionResult> {
  const [hasPythonFile, hasSourceDir] = await Promise.all([
    hasMatchingFile(
      targetDir,
      (fileName) => path.extname(fileName) === ".py" || fileName === "__init__.py",
      new Set(["__pycache__", ".venv", "venv"]),
    ),
    directoryExists(path.join(targetDir, "src")),
  ]);

  return {
    hasCode: hasPythonFile,
    ...(hasSourceDir ? { sourceDir: "src" } : {}),
  };
}

export async function detectProject(targetDir: string, lang: Lang): Promise<DetectionResult> {
  switch (lang) {
    case "typescript":
      return detectTypeScriptProject(targetDir);
    case "golang":
      return detectGoProject(targetDir);
    case "python":
      return detectPythonProject(targetDir);
    default:
      throw new Error(`Unsupported language: ${String(lang)}`);
  }
}
