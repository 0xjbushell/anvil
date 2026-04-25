import { readdir, readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";

export type EntryType = "file" | "directory" | "missing";
export type EntryState = "equal" | "left" | "right" | "distinct";
export type DiffReason = "different-content" | "different-size" | "different-name";

export interface DiffEntry {
  path1?: string;
  path2?: string;
  relativePath: string;
  name?: string;
  type1: EntryType;
  type2: EntryType;
  state: EntryState;
  reason?: DiffReason;
}

export interface CompareOptions {
  compareContent?: boolean;
  compareSize?: boolean;
  filter?: (relPath: string, name: string, isDir: boolean) => boolean;
}

export interface Result {
  same: boolean;
  differences: number;
  diffSet: DiffEntry[];
  total: number;
  equal: number;
  left: number;
  right: number;
  distinct: number;
}

interface Entry {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
}

async function listEntries(
  dir: string,
  relDir: string,
  filter?: CompareOptions["filter"],
): Promise<Entry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") return [];
    throw err;
  }
  const entries: Entry[] = [];
  for (const name of names) {
    const absolutePath = join(dir, name);
    let st;
    try {
      st = await stat(absolutePath);
    } catch (err: unknown) {
      if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ELOOP")) continue;
      throw err;
    }
    const isDirectory = st.isDirectory();
    const isFile = st.isFile();
    if (!isDirectory && !isFile) continue;
    const relativePath = relDir === "" ? name : posix.join(relDir, name);
    if (filter && !filter(relativePath, name, isDirectory)) continue;
    entries.push({ name, absolutePath, isDirectory, isFile, size: st.size });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function entryType(e: Entry | undefined): EntryType {
  if (!e) return "missing";
  return e.isDirectory ? "directory" : "file";
}

async function filesEqual(
  a: Entry,
  b: Entry,
  options: CompareOptions,
): Promise<{ equal: boolean; reason?: DiffReason }> {
  if (options.compareSize && a.size !== b.size) {
    return { equal: false, reason: "different-size" };
  }
  if (options.compareContent) {
    if (a.size !== b.size) return { equal: false, reason: "different-size" };
    const [bufA, bufB] = await Promise.all([readFile(a.absolutePath), readFile(b.absolutePath)]);
    if (bufA.equals(bufB)) return { equal: true };
    return { equal: false, reason: "different-content" };
  }
  return { equal: true };
}

async function walk(
  left: string,
  right: string,
  relDir: string,
  options: CompareOptions,
  diffSet: DiffEntry[],
  counters: { equal: number; left: number; right: number; distinct: number },
): Promise<void> {
  const [leftEntries, rightEntries] = await Promise.all([
    listEntries(join(left, relDir), relDir, options.filter),
    listEntries(join(right, relDir), relDir, options.filter),
  ]);

  let i = 0;
  let j = 0;
  while (i < leftEntries.length || j < rightEntries.length) {
    const l = leftEntries[i];
    const r = rightEntries[j];
    let cmp: number;
    if (l && r) cmp = l.name < r.name ? -1 : l.name > r.name ? 1 : 0;
    else if (l) cmp = -1;
    else cmp = 1;

    if (cmp === 0 && l && r) {
      const relativePath = relDir === "" ? l.name : posix.join(relDir, l.name);
      const t1 = entryType(l);
      const t2 = entryType(r);

      if (t1 !== t2) {
        diffSet.push({
          path1: l.absolutePath,
          path2: r.absolutePath,
          relativePath,
          name: l.name,
          type1: t1,
          type2: t2,
          state: "distinct",
          reason: "different-name",
        });
        counters.distinct++;
      } else if (l.isDirectory) {
        diffSet.push({
          path1: l.absolutePath,
          path2: r.absolutePath,
          relativePath,
          name: l.name,
          type1: "directory",
          type2: "directory",
          state: "equal",
        });
        counters.equal++;
        await walk(left, right, relativePath, options, diffSet, counters);
      } else {
        const result = await filesEqual(l, r, options);
        if (result.equal) {
          diffSet.push({
            path1: l.absolutePath,
            path2: r.absolutePath,
            relativePath,
            name: l.name,
            type1: "file",
            type2: "file",
            state: "equal",
          });
          counters.equal++;
        } else {
          diffSet.push({
            path1: l.absolutePath,
            path2: r.absolutePath,
            relativePath,
            name: l.name,
            type1: "file",
            type2: "file",
            state: "distinct",
            reason: result.reason,
          });
          counters.distinct++;
        }
      }
      i++;
      j++;
    } else if (cmp < 0 && l) {
      const relativePath = relDir === "" ? l.name : posix.join(relDir, l.name);
      diffSet.push({
        path1: l.absolutePath,
        relativePath,
        name: l.name,
        type1: entryType(l),
        type2: "missing",
        state: "left",
      });
      counters.left++;
      if (l.isDirectory) {
        await walk(left, right, relativePath, options, diffSet, counters);
      }
      i++;
    } else if (r) {
      const relativePath = relDir === "" ? r.name : posix.join(relDir, r.name);
      diffSet.push({
        path2: r.absolutePath,
        relativePath,
        name: r.name,
        type1: "missing",
        type2: entryType(r),
        state: "right",
      });
      counters.right++;
      if (r.isDirectory) {
        await walk(left, right, relativePath, options, diffSet, counters);
      }
      j++;
    }
  }
}

export async function compare(
  left: string,
  right: string,
  options: CompareOptions = {},
): Promise<Result> {
  const diffSet: DiffEntry[] = [];
  const counters = { equal: 0, left: 0, right: 0, distinct: 0 };
  await walk(left, right, "", options, diffSet, counters);
  const differences = counters.left + counters.right + counters.distinct;
  return {
    same: differences === 0,
    differences,
    diffSet,
    total: counters.equal + differences,
    equal: counters.equal,
    left: counters.left,
    right: counters.right,
    distinct: counters.distinct,
  };
}
