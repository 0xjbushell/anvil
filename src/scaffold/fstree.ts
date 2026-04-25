import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FileSource, FsTreeChange, FsTreeEntry } from "../types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function normalizeTreePath(filePath: string): string {
  const normalized = path.posix.normalize(filePath);

  if (
    normalized === "." ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith("../")
  ) {
    throw new Error(`FsTree paths must be relative POSIX paths: ${filePath}`);
  }

  return normalized;
}

export class FsTree {
  readonly #entries = new Map<string, FsTreeEntry>();

  read(filePath: string): string | undefined {
    return this.#entries.get(normalizeTreePath(filePath))?.content;
  }

  write(filePath: string, content: string, source: FileSource): void {
    const normalizedPath = normalizeTreePath(filePath);
    this.#entries.set(normalizedPath, {
      path: normalizedPath,
      content,
      source,
    });
  }

  exists(filePath: string): boolean {
    return this.#entries.has(normalizeTreePath(filePath));
  }

  delete(filePath: string): void {
    this.#entries.delete(normalizeTreePath(filePath));
  }

  rename(from: string, to: string): void {
    const fromPath = normalizeTreePath(from);
    const toPath = normalizeTreePath(to);
    const entry = this.#entries.get(fromPath);

    if (!entry || fromPath === toPath) {
      return;
    }

    this.#entries.set(toPath, {
      path: toPath,
      content: entry.content,
      source: entry.source,
    });
    this.#entries.delete(fromPath);
  }

  entries(): FsTreeEntry[] {
    return Array.from(this.#entries.values(), (entry) => ({ ...entry }));
  }

  async listChanges(targetDir: string): Promise<FsTreeChange[]> {
    const changes: FsTreeChange[] = [];

    for (const entry of this.#entries.values()) {
      let diskContent: string;

      try {
        diskContent = await readFile(path.join(targetDir, entry.path), "utf8");
      } catch (error) {
        if (isMissingFile(error)) {
          changes.push({ path: entry.path, action: "create" });
          continue;
        }

        throw error;
      }

      changes.push({
        path: entry.path,
        action: diskContent === entry.content ? "unchanged" : "update",
      });
    }

    return changes;
  }
}

export async function flushChanges(
  changes: FsTreeChange[],
  tree: FsTree,
  targetDir: string,
): Promise<void> {
  for (const change of changes) {
    if (change.action === "unchanged") {
      continue;
    }

    const normalizedPath = normalizeTreePath(change.path);
    const content = tree.read(normalizedPath);

    if (content === undefined) {
      throw new Error(`Cannot flush ${change.action} for missing FsTree entry: ${normalizedPath}`);
    }

    const filePath = path.join(targetDir, normalizedPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}
