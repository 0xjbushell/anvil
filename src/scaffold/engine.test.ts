import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type {
  AnvilLockfile,
  ConflictHandler,
  ConflictReport,
  Lang,
  LanguageManifest,
  ManifestEntry,
  ScaffoldContext,
} from "../types.ts";
import {
  LOCKFILE_NAME,
  computeChecksum,
  createLockfile,
  readLockfile,
  writeLockfile,
} from "./lockfile.ts";

let manifestEntries: ManifestEntry[] = [];

mock.module("../manifest.ts", () => ({
  getManifest: (lang: Lang): LanguageManifest => ({
    lang,
    entries: [...manifestEntries],
  }),
}));

const { IncompleteLockfileError, scaffold } = await import("./engine.ts");

const anvilRoot = path.resolve(import.meta.dir, "..", "..");

let scratch: string;
let sourceRoot: string;
let sourceRootName: string;
let chmodRestorePaths: string[] = [];

beforeEach(async () => {
  scratch = path.join(tmpdir(), `anvil-scaffold-engine-target-${randomUUID()}`);
  sourceRootName = `.anvil-engine-test-sources-${randomUUID()}`;
  sourceRoot = path.join(anvilRoot, sourceRootName);
  chmodRestorePaths = [];
  manifestEntries = [];

  await Promise.all([
    mkdir(scratch, { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
  ]);
});

afterEach(async () => {
  await Promise.allSettled(chmodRestorePaths.map((restorePath) => chmod(restorePath, 0o700)));

  await Promise.all([
    rm(scratch, { recursive: true, force: true }),
    rm(sourceRoot, { recursive: true, force: true }),
  ]);
});

afterAll(() => {
  mock.restore();
});

function makeContext(overrides: Partial<ScaffoldContext> = {}): ScaffoldContext {
  return {
    projectName: "example",
    lang: "typescript",
    targetDir: scratch,
    hasExistingCode: false,
    skipSeed: false,
    sourceDir: "src",
    packageManager: "bun",
    defaultBranch: "main",
    nonInteractive: false,
    toolchain: {
      bun: "1.1.31",
      node: "22.11.0",
    },
    anvilVersion: "0.1.0",
    year: 2026,
    ...overrides,
  };
}

function staticEntry(
  dest: string,
  sourcePath: string,
  when?: ManifestEntry["when"],
): ManifestEntry {
  return {
    dest,
    src: `${sourceRootName}/${sourcePath}`,
    source: "static",
    ...(when ? { when } : {}),
  };
}

function templateEntry(
  dest: string,
  sourcePath: string,
  when?: ManifestEntry["when"],
): ManifestEntry {
  return {
    dest,
    src: `${sourceRootName}/${sourcePath}`,
    source: "template",
    ...(when ? { when } : {}),
  };
}

async function writeSource(relativePath: string, content: string): Promise<void> {
  const filePath = path.join(sourceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function writeTarget(relativePath: string, content: string): Promise<void> {
  const filePath = path.join(scratch, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function readTarget(relativePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(scratch, relativePath), "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readWrittenLockfile(): Promise<AnvilLockfile> {
  return JSON.parse(await readFile(path.join(scratch, LOCKFILE_NAME), "utf8")) as AnvilLockfile;
}

function statuses(lockfile: AnvilLockfile): Record<string, string> {
  return Object.fromEntries(lockfile.files.map((entry) => [entry.path, entry.status]));
}

async function createReadOnlyDirectory(relativePath: string): Promise<void> {
  const directoryPath = path.join(scratch, relativePath);
  await mkdir(directoryPath, { recursive: true });
  await chmod(directoryPath, 0o500);
  chmodRestorePaths.push(directoryPath);
}

async function createInterruptedScaffold(): Promise<void> {
  await Promise.all([
    writeSource("a.txt", "A\n"),
    writeSource("b.txt", "B\n"),
    writeSource("c.txt", "C\n"),
    writeSource("d.txt", "D\n"),
    createReadOnlyDirectory("locked"),
  ]);
  manifestEntries = [
    staticEntry("a.txt", "a.txt"),
    staticEntry("b.txt", "b.txt"),
    staticEntry("locked/c.txt", "c.txt"),
    staticEntry("d.txt", "d.txt"),
  ];

  await expect(
    scaffold(makeContext({ nonInteractive: true }), { onReport: async () => {} }),
  ).rejects.toThrow();
}

describe("scaffold engine", () => {
  test("requires exactly one conflict boundary callback", async () => {
    await expect(scaffold(makeContext(), {})).rejects.toThrow(/exactly one/i);

    await expect(
      scaffold(makeContext(), {
        onConflict: async (filePath) => ({ path: filePath, action: "overwrite" }),
        onReport: async () => {},
      }),
    ).rejects.toThrow(/exactly one/i);
  });

  test("copies static files, renders EJS templates, creates parents, and returns an accurate result", async () => {
    await Promise.all([
      writeSource("static.txt", "static content\n"),
      writeSource("README.md.ejs", "# <%= projectName %>\nbranch=<%= defaultBranch %>\n"),
    ]);
    manifestEntries = [
      staticEntry("deep/nested/static.txt", "static.txt"),
      templateEntry("README.md", "README.md.ejs"),
    ];
    const reports: ConflictReport[] = [];

    const result = await scaffold(makeContext({ nonInteractive: true }), {
      onReport: async (report) => {
        reports.push(report);
      },
    });

    expect(reports).toEqual([]);
    expect(await readTarget("deep/nested/static.txt")).toBe("static content\n");
    expect(await readTarget("README.md")).toBe("# example\nbranch=main\n");
    expect([...result.filesCreated].sort()).toEqual(["README.md", "deep/nested/static.txt"]);
    expect(result.filesSkipped).toEqual([]);
    expect(result.lockfile.flushStatus).toBe("complete");
    expect(result.lockfile.toolchain).toEqual({ bun: "1.1.31", node: "22.11.0" });
    expect(result.lockfile.files.map((entry) => entry.path).sort()).toEqual([
      "README.md",
      "deep/nested/static.txt",
    ]);
    await expect(readLockfile(scratch)).resolves.toEqual({
      status: "complete",
      lockfile: result.lockfile,
    });
  });

  test("evaluates conditional entries as skipped or included", async () => {
    await writeSource("seed.txt", "seed\n");
    manifestEntries = [
      staticEntry("seed.txt", "seed.txt", (ctx) => !ctx.hasExistingCode),
    ];

    const skipped = await scaffold(makeContext({ hasExistingCode: true }), {
      onConflict: async (filePath) => ({ path: filePath, action: "overwrite" }),
    });
    expect(skipped.filesCreated).toEqual([]);
    expect(skipped.filesSkipped).toEqual(["seed.txt"]);
    expect(await readTarget("seed.txt")).toBeNull();

    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });

    const included = await scaffold(makeContext({ hasExistingCode: false }), {
      onConflict: async (filePath) => ({ path: filePath, action: "overwrite" }),
    });
    expect(included.filesCreated).toEqual(["seed.txt"]);
    expect(included.filesSkipped).toEqual([]);
    expect(await readTarget("seed.txt")).toBe("seed\n");
  });

  test("interactive mode collects overwrite and skip resolutions before writing", async () => {
    await Promise.all([
      writeSource("overwrite.txt", "new overwrite\n"),
      writeSource("skip.txt", "new skip\n"),
      writeSource("create.txt", "created\n"),
      writeTarget("overwrite.txt", "old overwrite\n"),
      writeTarget("skip.txt", "old skip\n"),
    ]);
    manifestEntries = [
      staticEntry("overwrite.txt", "overwrite.txt"),
      staticEntry("skip.txt", "skip.txt"),
      staticEntry("create.txt", "create.txt"),
    ];
    const calls: string[] = [];
    const onConflict: ConflictHandler = async (filePath) => {
      calls.push(filePath);
      expect(await readTarget("create.txt")).toBeNull();

      return {
        path: filePath,
        action: filePath === "skip.txt" ? "skip" : "overwrite",
      };
    };

    const result = await scaffold(makeContext(), { onConflict });

    expect(calls).toEqual(["overwrite.txt", "skip.txt"]);
    expect(await readTarget("overwrite.txt")).toBe("new overwrite\n");
    expect(await readTarget("skip.txt")).toBe("old skip\n");
    expect(await readTarget("create.txt")).toBe("created\n");
    expect([...result.filesCreated].sort()).toEqual(["create.txt", "overwrite.txt"]);
    expect(result.filesSkipped).toEqual(["skip.txt"]);
  });

  test("interactive skip preserves a prior managed lockfile entry", async () => {
    await Promise.all([
      writeSource("managed.txt", "new managed\n"),
      writeSource("created.txt", "created\n"),
      writeTarget("managed.txt", "user edited managed file\n"),
    ]);
    const oldLockfile = createLockfile(makeContext(), [
      { path: "managed.txt", content: "old generated managed file\n" },
    ]);
    await writeLockfile(scratch, oldLockfile);
    manifestEntries = [
      staticEntry("managed.txt", "managed.txt"),
      staticEntry("created.txt", "created.txt"),
    ];

    const result = await scaffold(makeContext(), {
      onConflict: async (filePath) => ({ path: filePath, action: "skip" }),
    });

    expect(await readTarget("managed.txt")).toBe("user edited managed file\n");
    expect(await readTarget("created.txt")).toBe("created\n");
    expect(result.filesCreated).toEqual(["created.txt"]);
    expect(result.filesSkipped).toEqual(["managed.txt"]);
    expect(result.lockfile.files).toContainEqual(oldLockfile.files[0]);
    expect(result.lockfile.files).toContainEqual({
      path: "created.txt",
      checksum: computeChecksum("created\n"),
      status: "written",
    });
  });

  test("interactive abort produces zero data writes and no checkpoint lockfile", async () => {
    await Promise.all([
      writeSource("a.txt", "new A\n"),
      writeSource("b.txt", "new B\n"),
      writeSource("c.txt", "new C\n"),
      writeSource("d.txt", "new D\n"),
      writeTarget("a.txt", "old A\n"),
      writeTarget("b.txt", "old B\n"),
      writeTarget("c.txt", "old C\n"),
    ]);
    manifestEntries = [
      staticEntry("a.txt", "a.txt"),
      staticEntry("b.txt", "b.txt"),
      staticEntry("c.txt", "c.txt"),
      staticEntry("d.txt", "d.txt"),
    ];
    const calls: string[] = [];
    const onConflict: ConflictHandler = async (filePath) => {
      calls.push(filePath);
      return {
        path: filePath,
        action: filePath === "c.txt" ? "abort" : "overwrite",
      };
    };

    await expect(scaffold(makeContext(), { onConflict })).rejects.toThrow(/aborted/i);

    expect(calls).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(await readTarget("a.txt")).toBe("old A\n");
    expect(await readTarget("b.txt")).toBe("old B\n");
    expect(await readTarget("c.txt")).toBe("old C\n");
    expect(await readTarget("d.txt")).toBeNull();
    expect(await readTarget(LOCKFILE_NAME)).toBeNull();
  });

  test("non-interactive updates call the reporter and stop before any writes or checkpoint", async () => {
    await Promise.all([
      writeSource("a.txt", "new A\n"),
      writeSource("b.txt", "new B\n"),
      writeSource("c.txt", "new C\n"),
      writeTarget("a.txt", "old A\n"),
      writeTarget("b.txt", "old B\n"),
    ]);
    manifestEntries = [
      staticEntry("a.txt", "a.txt"),
      staticEntry("b.txt", "b.txt"),
      staticEntry("c.txt", "c.txt"),
    ];
    const reports: ConflictReport[] = [];

    await expect(
      scaffold(makeContext({ nonInteractive: true }), {
        onReport: async (report) => {
          reports.push(report);
        },
      }),
    ).rejects.toThrow(/conflict/i);

    expect(reports).toEqual([
      {
        updates: [
          { path: "a.txt", existingContent: "old A\n", newContent: "new A\n" },
          { path: "b.txt", existingContent: "old B\n", newContent: "new B\n" },
        ],
      },
    ]);
    expect(await readTarget("a.txt")).toBe("old A\n");
    expect(await readTarget("b.txt")).toBe("old B\n");
    expect(await readTarget("c.txt")).toBeNull();
    expect(await readTarget(LOCKFILE_NAME)).toBeNull();
  });

  test("lockfile status errors are surfaced before rendering or writing", async () => {
    await writeFile(path.join(scratch, LOCKFILE_NAME), "{not json", "utf8");
    manifestEntries = [staticEntry("missing.txt", "missing-source.txt")];

    await expect(
      scaffold(makeContext(), {
        onConflict: async (filePath) => ({ path: filePath, action: "overwrite" }),
      }),
    ).rejects.toThrow(/corrupt/i);

    await rm(path.join(scratch, LOCKFILE_NAME), { force: true });

    const crossLang = createLockfile(
      makeContext({ lang: "golang", packageManager: undefined }),
      [],
    );
    await writeLockfile(scratch, crossLang);

    await expect(
      scaffold(makeContext({ lang: "typescript" }), {
        onConflict: async (filePath) => ({ path: filePath, action: "overwrite" }),
      }),
    ).rejects.toThrow(/cross-language/i);
  });

  test("non-interactive in-progress lockfiles throw a typed incomplete-lockfile error", async () => {
    const inProgress = createLockfile(makeContext(), [
      { path: "pending.txt", content: "pending\n" },
    ]);
    await writeLockfile(scratch, { ...inProgress, flushStatus: "in-progress" });
    manifestEntries = [staticEntry("pending.txt", "missing-source.txt")];

    await expect(
      scaffold(makeContext({ nonInteractive: true }), { onReport: async () => {} }),
    ).rejects.toBeInstanceOf(IncompleteLockfileError);
    expect(await readTarget("pending.txt")).toBeNull();
  });

  test("pure no-op re-scaffold returns the existing lockfile without rewriting it", async () => {
    await writeSource("README.md", "# example\n");
    manifestEntries = [staticEntry("README.md", "README.md")];

    const first = await scaffold(makeContext({ nonInteractive: true }), {
      onReport: async () => {},
    });
    const rawLockfile = await readTarget(LOCKFILE_NAME);

    const second = await scaffold(makeContext({ nonInteractive: true }), {
      onReport: async () => {},
    });

    expect(second.filesCreated).toEqual([]);
    expect(second.filesSkipped).toEqual([]);
    expect(second.lockfile).toEqual(first.lockfile);
    expect(await readTarget(LOCKFILE_NAME)).toBe(rawLockfile);
  });

  test("generator manifest entries fail clearly without writing a lockfile", async () => {
    manifestEntries = [
      {
        dest: "package.json",
        src: "typescript/package-json",
        source: "generator",
      },
    ];

    await expect(
      scaffold(makeContext({ nonInteractive: true }), { onReport: async () => {} }),
    ).rejects.toThrow(/generator.*not implemented/i);
    expect(await readTarget(LOCKFILE_NAME)).toBeNull();
  });

  test("writes the in-progress checkpoint before the first data-file write", async () => {
    await Promise.all([
      writeSource("blocked.txt", "blocked\n"),
      createReadOnlyDirectory("locked"),
    ]);
    manifestEntries = [staticEntry("locked/blocked.txt", "blocked.txt")];

    await expect(
      scaffold(makeContext({ nonInteractive: true }), { onReport: async () => {} }),
    ).rejects.toThrow();

    const lockfile = await readWrittenLockfile();
    expect(lockfile.flushStatus).toBe("in-progress");
    expect(statuses(lockfile)).toEqual({ "locked/blocked.txt": "pending" });
    expect(await readTarget("locked/blocked.txt")).toBeNull();
  });

  test("mid-flush failure leaves written entries marked and later entries pending", async () => {
    await createInterruptedScaffold();

    expect(await readTarget("a.txt")).toBe("A\n");
    expect(await readTarget("b.txt")).toBe("B\n");
    expect(await readTarget("locked/c.txt")).toBeNull();
    expect(await readTarget("d.txt")).toBeNull();

    const lockfile = await readWrittenLockfile();
    expect(lockfile.flushStatus).toBe("in-progress");
    expect(statuses(lockfile)).toEqual({
      "a.txt": "written",
      "b.txt": "written",
      "d.txt": "pending",
      "locked/c.txt": "pending",
    });
  });

  test("interactive rerun resumes an in-progress lockfile and finalizes it", async () => {
    await createInterruptedScaffold();
    await chmod(path.join(scratch, "locked"), 0o700);

    const conflicts: string[] = [];
    const result = await scaffold(makeContext(), {
      onConflict: async (filePath) => {
        conflicts.push(filePath);
        return { path: filePath, action: "overwrite" };
      },
    });

    expect(conflicts).toEqual([]);
    expect(await readTarget("a.txt")).toBe("A\n");
    expect(await readTarget("b.txt")).toBe("B\n");
    expect(await readTarget("locked/c.txt")).toBe("C\n");
    expect(await readTarget("d.txt")).toBe("D\n");
    expect(result.lockfile.flushStatus).toBe("complete");
    expect(result.lockfile.files.every((entry) => entry.status === "written")).toBe(true);
    expect(await readLockfile(scratch)).toEqual({
      status: "complete",
      lockfile: result.lockfile,
    });
  });

  test("non-interactive rerun on an in-progress lockfile writes nothing", async () => {
    await createInterruptedScaffold();
    await chmod(path.join(scratch, "locked"), 0o700);
    const before = await readWrittenLockfile();

    await expect(
      scaffold(makeContext({ nonInteractive: true }), { onReport: async () => {} }),
    ).rejects.toBeInstanceOf(IncompleteLockfileError);

    expect(await readTarget("locked/c.txt")).toBeNull();
    expect(await readTarget("d.txt")).toBeNull();
    expect(await readWrittenLockfile()).toEqual(before);
  });
});
