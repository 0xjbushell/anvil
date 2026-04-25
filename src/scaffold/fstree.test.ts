import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { FsTreeChange } from "../types.ts";
import { FsTree, flushChanges } from "./fstree.ts";

let scratch: string;

beforeEach(async () => {
  scratch = path.join(tmpdir(), `anvil-scaffold-fstree-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function writeDisk(relativePath: string, content: string): Promise<void> {
  const filePath = path.join(scratch, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function readDisk(relativePath: string): Promise<string> {
  return readFile(path.join(scratch, relativePath), "utf8");
}

function sortedChanges(changes: FsTreeChange[]): FsTreeChange[] {
  return [...changes].sort((left, right) => left.path.localeCompare(right.path));
}

describe("FsTree", () => {
  test("read/write/exists are normalized and last writer wins", () => {
    const tree = new FsTree();

    expect(tree.read("src/index.ts")).toBeUndefined();
    expect(tree.exists("src/index.ts")).toBe(false);

    tree.write("src//lib/../index.ts", "first", "template");
    expect(tree.read("src/index.ts")).toBe("first");
    expect(tree.exists("src/index.ts")).toBe(true);

    tree.write("src/index.ts", "second", "generator");

    expect(tree.read("src/index.ts")).toBe("second");
    expect(tree.entries()).toEqual([
      {
        path: "src/index.ts",
        content: "second",
        source: "generator",
      },
    ]);
  });

  test("delete removes entries and listChanges ignores deleted paths", async () => {
    const tree = new FsTree();
    tree.write("remove.txt", "generated", "static");
    tree.delete("remove.txt");
    await writeDisk("remove.txt", "on disk");

    expect(tree.read("remove.txt")).toBeUndefined();
    expect(tree.exists("remove.txt")).toBe(false);
    expect(tree.entries()).toEqual([]);
    expect(await tree.listChanges(scratch)).toEqual([]);
  });

  test("rename preserves content and source metadata", () => {
    const tree = new FsTree();

    tree.write("from.txt", "content", "static");
    tree.rename("from.txt", "nested//to.txt");

    expect(tree.read("from.txt")).toBeUndefined();
    expect(tree.exists("from.txt")).toBe(false);
    expect(tree.read("nested/to.txt")).toBe("content");
    expect(tree.entries()).toEqual([
      {
        path: "nested/to.txt",
        content: "content",
        source: "static",
      },
    ]);
  });

  test("listChanges classifies create, update, and unchanged actions", async () => {
    const tree = new FsTree();
    await writeDisk("same.txt", "same");
    await writeDisk("different.txt", "old");

    tree.write("new.txt", "new", "template");
    tree.write("same.txt", "same", "template");
    tree.write("different.txt", "new", "template");

    expect(sortedChanges(await tree.listChanges(scratch))).toEqual([
      { path: "different.txt", action: "update" },
      { path: "new.txt", action: "create" },
      { path: "same.txt", action: "unchanged" },
    ]);
  });

  test("rerun against a matching directory reports every entry unchanged", async () => {
    const tree = new FsTree();
    tree.write("README.md", "# Project\n", "static");
    tree.write("src/index.ts", "export const value = 1;\n", "template");
    await writeDisk("README.md", "# Project\n");
    await writeDisk("src/index.ts", "export const value = 1;\n");

    expect(sortedChanges(await tree.listChanges(scratch))).toEqual([
      { path: "README.md", action: "unchanged" },
      { path: "src/index.ts", action: "unchanged" },
    ]);
  });

  test("modified on-disk content reports update for that path", async () => {
    const tree = new FsTree();
    await writeDisk("config.json", "{ \"mode\": \"manual\" }\n");

    tree.write("config.json", "{ \"mode\": \"generated\" }\n", "template");

    expect(await tree.listChanges(scratch)).toEqual([{ path: "config.json", action: "update" }]);
  });

  test("flushChanges writes create and update entries but skips unchanged entries", async () => {
    const tree = new FsTree();
    await writeDisk("update.txt", "old");
    await writeDisk("unchanged.txt", "disk");

    tree.write("create.txt", "created", "static");
    tree.write("update.txt", "updated", "template");
    tree.write("unchanged.txt", "tree content that must not be written", "generator");

    await flushChanges(
      [
        { path: "create.txt", action: "create" },
        { path: "update.txt", action: "update" },
        { path: "unchanged.txt", action: "unchanged" },
      ],
      tree,
      scratch,
    );

    expect(await readDisk("create.txt")).toBe("created");
    expect(await readDisk("update.txt")).toBe("updated");
    expect(await readDisk("unchanged.txt")).toBe("disk");
  });

  test("flushChanges creates parent directories", async () => {
    const tree = new FsTree();
    tree.write("nested/deep/file.txt", "content", "generator");

    await flushChanges([{ path: "nested/deep/file.txt", action: "create" }], tree, scratch);

    expect(await readDisk("nested/deep/file.txt")).toBe("content");
  });

  test("listChanges surfaces filesystem errors other than missing files", async () => {
    const tree = new FsTree();
    await mkdir(path.join(scratch, "directory.txt"), { recursive: true });

    tree.write("directory.txt", "content", "static");

    await expect(tree.listChanges(scratch)).rejects.toThrow();
  });

  test("rejects paths that normalize outside the tree boundary", () => {
    const tree = new FsTree();

    expect(() => tree.write("..", "content", "static")).toThrow("relative POSIX");
    expect(() => tree.write("../outside.txt", "content", "static")).toThrow("relative POSIX");
  });
});
