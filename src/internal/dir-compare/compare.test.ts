import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compare } from "./compare.ts";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "dir-compare-test-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function makeTree(root: string, files: Record<string, string>): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    const dir = full.substring(0, full.lastIndexOf("/"));
    if (dir && dir !== root) await mkdir(dir, { recursive: true });
    await writeFile(full, content);
  }
}

describe("compare", () => {
  test("identical dirs: same true, zero differences", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "x.txt": "hello", "y.txt": "world" });
    await makeTree(b, { "x.txt": "hello", "y.txt": "world" });

    const result = await compare(a, b, { compareContent: true });
    expect(result.same).toBe(true);
    expect(result.differences).toBe(0);
    expect(result.equal).toBe(2);
  });

  test("content differences: distinct + reason different-content", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "x.txt": "hello" });
    await makeTree(b, { "x.txt": "world" });

    const result = await compare(a, b, { compareContent: true });
    expect(result.same).toBe(false);
    expect(result.distinct).toBe(1);
    const diff = result.diffSet.find((d) => d.relativePath === "x.txt");
    expect(diff?.state).toBe("distinct");
    expect(diff?.reason).toBe("different-content");
  });

  test("missing on left: state right, type1 missing", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, {});
    await makeTree(b, { "only-right.txt": "x" });

    const result = await compare(a, b);
    expect(result.same).toBe(false);
    expect(result.right).toBe(1);
    const diff = result.diffSet.find((d) => d.relativePath === "only-right.txt");
    expect(diff?.state).toBe("right");
    expect(diff?.type1).toBe("missing");
    expect(diff?.type2).toBe("file");
  });

  test("missing on right: state left, type2 missing", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "only-left.txt": "x" });
    await makeTree(b, {});

    const result = await compare(a, b);
    expect(result.same).toBe(false);
    expect(result.left).toBe(1);
    const diff = result.diffSet.find((d) => d.relativePath === "only-left.txt");
    expect(diff?.state).toBe("left");
    expect(diff?.type1).toBe("file");
    expect(diff?.type2).toBe("missing");
  });

  test("filter callback excludes matching paths from both sides", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "keep.txt": "k", "skip.txt": "left-only" });
    await makeTree(b, { "keep.txt": "k" });

    const result = await compare(a, b, {
      compareContent: true,
      filter: (_rel, name) => name !== "skip.txt",
    });
    expect(result.same).toBe(true);
    expect(result.diffSet.find((d) => d.name === "skip.txt")).toBeUndefined();
  });

  test("nested directories produce correct relative paths", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "sub/inner/file.txt": "hi" });
    await makeTree(b, { "sub/inner/file.txt": "bye" });

    const result = await compare(a, b, { compareContent: true });
    const diff = result.diffSet.find((d) => d.relativePath === "sub/inner/file.txt");
    expect(diff).toBeDefined();
    expect(diff?.state).toBe("distinct");
  });

  test("size-only fast path treats same-size different-content as equal", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "x.txt": "abcde" });
    await makeTree(b, { "x.txt": "vwxyz" });

    const result = await compare(a, b, { compareSize: true, compareContent: false });
    expect(result.same).toBe(true);
    expect(result.equal).toBe(1);
  });

  test("name-only default reports same-name different-content as equal", async () => {
    const a = join(scratch, "a");
    const b = join(scratch, "b");
    await makeTree(a, { "x.txt": "alpha" });
    await makeTree(b, { "x.txt": "beta-and-longer" });

    const result = await compare(a, b);
    expect(result.same).toBe(true);
    expect(result.equal).toBe(1);
  });

  // AC: greenfield fixture compared to itself is `same: true`.
  // The fixture is created by parallel ticket TIX-000058 and may not exist.
  // We always assert the temp-dir-vs-itself case; if the fixture is present
  // we additionally assert against it.
  test("dir compared to itself is same: true (greenfield AC)", async () => {
    const a = join(scratch, "self");
    await makeTree(a, { "a.txt": "1", "sub/b.txt": "2" });
    const result = await compare(a, a, { compareContent: true });
    expect(result.same).toBe(true);
    expect(result.differences).toBe(0);

    const fixture = "tests/fixtures/inputs/greenfield/";
    let fixtureExists = true;
    try {
      await access(fixture);
    } catch {
      fixtureExists = false;
    }
    if (fixtureExists) {
      const r2 = await compare(fixture, fixture, { compareContent: true });
      expect(r2.same).toBe(true);
    }
  });
});
