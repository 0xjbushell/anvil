import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { AnvilLockfile, LockfileEntry, ScaffoldContext } from "../types.ts";
import {
  LOCKFILE_NAME,
  computeChecksum,
  createLockfile,
  diffLockfiles,
  finalizeLockfile,
  isTextFile,
  markEntryWritten,
  normalizeForChecksum,
  readLockfile,
  writeLockfile,
  writeLockfileCheckpoint,
  refreshLockfileChecksums,
} from "./lockfile.ts";

type TestScaffoldContext = ScaffoldContext & { year?: number };

const strictUtcIsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let scratch: string;

beforeEach(async () => {
  scratch = path.join(tmpdir(), `anvil-scaffold-lockfile-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function entry(pathName: string, checksum: string, status: LockfileEntry["status"] = "written"): LockfileEntry {
  return {
    path: pathName,
    checksum,
    status,
  };
}

function makeLockfile(overrides: Partial<AnvilLockfile> = {}): AnvilLockfile {
  const now = "2026-04-25T04:47:07.210Z";

  return {
    version: "0.1.0",
    lang: "typescript",
    flushStatus: "complete",
    context: {
      projectName: "example",
      packageManager: "bun",
      defaultBranch: "main",
      sourceDir: "src",
      skipSeed: false,
      year: 2026,
    },
    toolchain: {
      bun: "1.1.31",
      node: "22.11.0",
    },
    files: [
      entry("README.md", computeChecksum("readme")),
      entry("src/index.ts", computeChecksum("index")),
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeContext(overrides: Partial<TestScaffoldContext> = {}): TestScaffoldContext {
  return {
    projectName: "example",
    lang: "typescript",
    targetDir: scratch,
    hasExistingCode: false,
    skipSeed: false,
    sourceDir: "src",
    packageManager: "bun",
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: {
      bun: "1.1.31",
      node: "22.11.0",
    },
    anvilVersion: "0.1.0",
    ...overrides,
  };
}

describe("scaffold lockfile", () => {
  test("LOCKFILE_NAME is .anvil.lock", () => {
    expect(LOCKFILE_NAME).toBe(".anvil.lock");
  });

  test("read/write roundtrip preserves a complete lockfile with D-70 read status", async () => {
    const lock = makeLockfile();

    await writeLockfile(scratch, lock);

    await expect(readLockfile(scratch)).resolves.toEqual({
      status: "complete",
      lockfile: lock,
    });
  });

  test("readLockfile returns absent status when the lockfile is missing", async () => {
    await expect(readLockfile(scratch)).resolves.toEqual({
      status: "absent",
      lockfile: null,
    });
  });

  test("readLockfile returns corrupt status when the lockfile contains invalid JSON", async () => {
    await writeFile(path.join(scratch, LOCKFILE_NAME), "{not-json", "utf8");

    const result = await readLockfile(scratch);

    expect(result.status).toBe("corrupt");
    expect(result.lockfile).toBeNull();
    expect(result).toHaveProperty("error");
  });

  test("readLockfile returns corrupt status when flushStatus cannot classify the lockfile", async () => {
    const lock = makeLockfile();
    await writeFile(
      path.join(scratch, LOCKFILE_NAME),
      `${JSON.stringify({ ...lock, flushStatus: "unknown" }, null, 2)}\n`,
      "utf8",
    );

    const result = await readLockfile(scratch);

    expect(result.status).toBe("corrupt");
    expect(result.lockfile).toBeNull();
    expect(result).toHaveProperty("error");
  });

  test("computeChecksum is deterministic and uses the exact sha256 format", () => {
    const first = computeChecksum("hello world");
    const second = computeChecksum("hello world");

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("computeChecksum changes when content changes", () => {
    expect(computeChecksum("hello")).not.toBe(computeChecksum("world"));
  });

  test("normalizeForChecksum normalizes text line endings and preserves binary bytes", () => {
    const text = Buffer.from("one\r\ntwo\r\nthree\r", "utf8");
    const binary = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
    const everyByte = Buffer.from(Array.from({ length: 256 }, (_, index) => index));

    expect(normalizeForChecksum(text, true).toString("utf8")).toBe("one\ntwo\nthree");
    expect(normalizeForChecksum(binary, false)).toEqual(binary);
    expect(normalizeForChecksum(everyByte, false)).toEqual(everyByte);
  });

  test("isTextFile classifies the v1 text allow-list and known binary extensions", () => {
    const textPaths = [
      "src/index.ts",
      "src/index.js",
      "src/view.tsx",
      "src/view.jsx",
      "cmd/app/main.go",
      "src/main.py",
      "README.md",
      ".pre-commit-config.yaml",
      ".golangci.yml",
      "package.json",
      "pyproject.toml",
      "notes.txt",
      "script.sh",
      "go.mod",
      "go.sum",
      "Makefile",
      ".gitignore",
      ".gitattributes",
      "src/templates/typescript/package.json.ejs",
    ];

    for (const textPath of textPaths) {
      expect(isTextFile(textPath)).toBe(true);
    }

    for (const binaryPath of ["logo.png", "photo.jpg", "anim.gif", "favicon.ico", "font.woff", "font.woff2"]) {
      expect(isTextFile(binaryPath)).toBe(false);
    }
  });

  test("refreshLockfileChecksums only updates requested tracked entries", async () => {
    const lock = makeLockfile({
      files: [
        entry("go.mod", computeChecksum("module before\n")),
        entry("README.md", computeChecksum("preserved old content\n")),
      ],
    });
    await writeFile(path.join(scratch, "go.mod"), "module after\n", "utf8");
    await writeFile(path.join(scratch, "README.md"), "user modified content\n", "utf8");

    const refreshed = await refreshLockfileChecksums(scratch, lock, ["go.mod"]);

    expect(refreshed.files).toEqual([
      entry("go.mod", computeChecksum("module after\n")),
      entry("README.md", computeChecksum("preserved old content\n")),
    ]);
  });

  test("refreshLockfileChecksums rejects untracked paths", async () => {
    await expect(refreshLockfileChecksums(scratch, makeLockfile(), ["go.mod"])).rejects.toThrow(
      'Cannot refresh untracked lockfile entries: go.mod',
    );
  });

  test("diffLockfiles detects added files", () => {
    const oldLock = makeLockfile({
      files: [entry("A", "sha256:a"), entry("B", "sha256:b")],
    });
    const newLock = makeLockfile({
      files: [entry("A", "sha256:a"), entry("B", "sha256:b"), entry("C", "sha256:c")],
    });

    expect(diffLockfiles(oldLock, newLock)).toEqual({
      added: [entry("C", "sha256:c")],
      removed: [],
      changed: [],
      unchanged: [entry("A", "sha256:a"), entry("B", "sha256:b")],
    });
  });

  test("diffLockfiles detects removed files", () => {
    const oldLock = makeLockfile({
      files: [entry("A", "sha256:a"), entry("B", "sha256:b"), entry("C", "sha256:c")],
    });
    const newLock = makeLockfile({
      files: [entry("A", "sha256:a"), entry("B", "sha256:b")],
    });

    expect(diffLockfiles(oldLock, newLock).removed).toEqual([entry("C", "sha256:c")]);
  });

  test("diffLockfiles detects changed files without stale source fields", () => {
    const oldLock = makeLockfile({
      files: [entry("A", "sha256:old")],
    });
    const newLock = makeLockfile({
      files: [entry("A", "sha256:new", "pending")],
    });
    const changed = diffLockfiles(oldLock, newLock).changed;

    expect(changed).toEqual([
      {
        path: "A",
        oldChecksum: "sha256:old",
        newChecksum: "sha256:new",
        status: "pending",
      },
    ]);
    expect(changed[0]).not.toHaveProperty("source");
  });

  test("diffLockfiles detects unchanged files", () => {
    const lock = makeLockfile({
      files: [entry("A", "sha256:a")],
    });

    expect(diffLockfiles(lock, lock).unchanged).toEqual([entry("A", "sha256:a")]);
  });

  test("diffLockfiles detects mixed added, removed, changed, and unchanged categories", () => {
    const oldLock = makeLockfile({
      files: [entry("A", "sha256:old-a"), entry("B", "sha256:b"), entry("C", "sha256:c")],
    });
    const newLock = makeLockfile({
      files: [entry("A", "sha256:new-a"), entry("C", "sha256:c"), entry("D", "sha256:d")],
    });

    expect(diffLockfiles(oldLock, newLock)).toEqual({
      added: [entry("D", "sha256:d")],
      removed: [entry("B", "sha256:b")],
      changed: [
        {
          path: "A",
          oldChecksum: "sha256:old-a",
          newChecksum: "sha256:new-a",
          status: "written",
        },
      ],
      unchanged: [entry("C", "sha256:c")],
    });
  });

  test("createLockfile builds a complete sorted lockfile from ScaffoldContext", () => {
    const lock = createLockfile(makeContext(), [
      { path: "src/index.ts", content: "export const value = 1;\r\n" },
      { path: "README.md", content: "# Example\r\n" },
    ]);

    expect(lock.version).toBe("0.1.0");
    expect(lock.lang).toBe("typescript");
    expect(lock.flushStatus).toBe("complete");
    expect(lock.context).toEqual({
      projectName: "example",
      packageManager: "bun",
      defaultBranch: "main",
      sourceDir: "src",
      skipSeed: false,
      year: new Date().getFullYear(),
    });
    expect(lock.toolchain).toEqual({ bun: "1.1.31", node: "22.11.0" });
    expect(lock.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);
    expect(lock.files).toEqual([
      entry("README.md", computeChecksum("# Example\n")),
      entry("src/index.ts", computeChecksum("export const value = 1;\n")),
    ]);
    expect(lock.createdAt).toMatch(strictUtcIsoTimestamp);
    expect(lock.updatedAt).toMatch(strictUtcIsoTimestamp);
    expect(Date.parse(lock.createdAt)).toBeLessThanOrEqual(Date.parse(lock.updatedAt));
  });

  test("createLockfile preserves a context year supplied by the caller", () => {
    const lock = createLockfile(makeContext({ year: 2025 }), [
      { path: "README.md", content: "# Example\n" },
    ]);

    expect(lock.context.year).toBe(2025);
  });

  test("writeLockfile writes formatted JSON with a trailing newline", async () => {
    const lock = makeLockfile();

    await writeLockfile(scratch, lock);
    const raw = await readFile(path.join(scratch, LOCKFILE_NAME), "utf8");

    expect(raw).toContain('\n  "version": "0.1.0"');
    expect(raw.endsWith("\n")).toBe(true);
  });

  test("checkpoint helpers write in-progress state, mark entries, finalize, and preserve interrupted state", async () => {
    const complete = makeLockfile({
      files: [entry("README.md", computeChecksum("readme")), entry("src/index.ts", computeChecksum("index"))],
    });

    const checkpoint = await writeLockfileCheckpoint(scratch, complete);
    expect(checkpoint.flushStatus).toBe("in-progress");
    expect(checkpoint.files.map((file) => file.status)).toEqual(["pending", "pending"]);
    await expect(readLockfile(scratch)).resolves.toEqual({
      status: "in-progress",
      lockfile: checkpoint,
    });

    const interrupted = await markEntryWritten(scratch, checkpoint, "README.md");
    expect(interrupted.flushStatus).toBe("in-progress");
    expect(interrupted.files).toEqual([
      entry("README.md", computeChecksum("readme"), "written"),
      entry("src/index.ts", computeChecksum("index"), "pending"),
    ]);
    await expect(readLockfile(scratch)).resolves.toEqual({
      status: "in-progress",
      lockfile: interrupted,
    });

    const stillInterrupted = await readLockfile(scratch);
    expect(stillInterrupted).toEqual({
      status: "in-progress",
      lockfile: interrupted,
    });

    const readyToFinalize = await markEntryWritten(scratch, interrupted, "src/index.ts");
    const finalized = await finalizeLockfile(scratch, readyToFinalize);
    expect(finalized.flushStatus).toBe("complete");
    expect(finalized.files.map((file) => file.status)).toEqual(["written", "written"]);
    await expect(readLockfile(scratch)).resolves.toEqual({
      status: "complete",
      lockfile: finalized,
    });
  });

  test("markEntryWritten refuses to mark entries that are not tracked", async () => {
    const checkpoint = makeLockfile({
      flushStatus: "in-progress",
      files: [entry("README.md", computeChecksum("readme"), "pending")],
    });

    await expect(markEntryWritten(scratch, checkpoint, "src/missing.ts")).rejects.toThrow(/not tracked/i);
  });

  test("finalizeLockfile refuses to complete while entries are still pending", async () => {
    const checkpoint = makeLockfile({
      flushStatus: "in-progress",
      files: [entry("README.md", computeChecksum("readme"), "pending")],
    });

    await expect(finalizeLockfile(scratch, checkpoint)).rejects.toThrow(/pending.*entries/i);
  });
});
