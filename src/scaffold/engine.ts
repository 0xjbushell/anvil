import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import ejs from "ejs";

import { getManifest as getDefaultManifest } from "../manifest.ts";
import type {
  AnvilLockfile,
  ConflictHandler,
  ConflictReport,
  ConflictResult,
  FileSource,
  FsTreeChange,
  FsTreeEntry,
  Lang,
  LanguageManifest,
  LockfileReadResult,
  ManifestEntry,
  ScaffoldContext,
} from "../types.ts";
import { flushChanges, FsTree } from "./fstree.ts";
import {
  createLockfile,
  finalizeLockfile,
  markEntryWritten,
  readLockfile,
  writeLockfile,
  writeLockfileCheckpoint,
} from "./lockfile.ts";

export interface ScaffoldResult {
  filesCreated: string[];
  filesSkipped: string[];
  lockfile: AnvilLockfile;
}

export interface ScaffoldPreviewResult {
  changes: FsTreeChange[];
  filesSkipped: string[];
  lockfile: AnvilLockfile | null;
}

export interface ScaffoldOptions {
  onConflict?: ConflictHandler;
  onReport?: (report: ConflictReport) => Promise<void>;
  getManifest?: ManifestProvider;
}

export interface ScaffoldPreviewOptions {
  getManifest?: ManifestProvider;
}

export class IncompleteLockfileError extends Error {
  constructor() {
    super(
      "Previous init was interrupted. Re-run interactively to resume, or run 'anvil doctor' for details.",
    );
    this.name = "IncompleteLockfileError";
  }
}

export class ScaffoldConflictError extends Error {
  constructor(conflictCount: number) {
    super(
      `Scaffold encountered ${conflictCount} update conflict${
        conflictCount === 1 ? "" : "s"
      } in non-interactive mode.`,
    );
    this.name = "ScaffoldConflictError";
  }
}

const globAllSuffix = "/**/*";
const anvilRoot = path.resolve(import.meta.dir, "..", "..");

interface BuiltTree {
  tree: FsTree;
  filesSkipped: string[];
}

interface ConflictDecision {
  approvedChanges: FsTreeChange[];
  filesSkipped: string[];
}

type ManifestProvider = (lang: Lang) => LanguageManifest;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withScaffoldErrorContext<T>(message: string, operation: () => T | Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(operation)
    .catch((error) => {
      throw new Error(`${message}: ${describeError(error)}`, { cause: error });
    });
}

function assertInsideAnvilRoot(sourcePath: string, absolutePath: string): void {
  const rootPrefix = `${anvilRoot}${path.sep}`;

  if (absolutePath !== anvilRoot && !absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Scaffold source path escapes the anvil root: ${sourcePath}`);
  }
}

function resolveSourcePath(sourcePath: string): string {
  const absolutePath = path.resolve(anvilRoot, sourcePath);
  assertInsideAnvilRoot(sourcePath, absolutePath);
  return absolutePath;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function validateOptions(ctx: ScaffoldContext, options: ScaffoldOptions): void {
  const hasConflictHandler = options.onConflict !== undefined;
  const hasReporter = options.onReport !== undefined;

  if (hasConflictHandler === hasReporter) {
    throw new Error("Scaffold requires exactly one of onConflict or onReport.");
  }

  if (ctx.nonInteractive && !hasReporter) {
    throw new Error("Non-interactive scaffold requires onReport.");
  }

  if (!ctx.nonInteractive && !hasConflictHandler) {
    throw new Error("Interactive scaffold requires onConflict.");
  }
}

function lockfileFromReadResult(result: LockfileReadResult): AnvilLockfile | null {
  if (result.status === "absent" || result.status === "corrupt") {
    return null;
  }

  return result.lockfile;
}

function validateLockfileStatus(ctx: ScaffoldContext, result: LockfileReadResult): AnvilLockfile | null {
  if (result.status === "corrupt") {
    throw new Error(`Cannot read corrupt .anvil.lock: ${describeError(result.error)}`);
  }

  const oldLockfile = lockfileFromReadResult(result);
  if (oldLockfile === null) {
    return null;
  }

  if (oldLockfile.lang !== ctx.lang) {
    throw new Error(
      `Cross-language re-scaffold is not supported (existing project is ${oldLockfile.lang}, requested ${ctx.lang}). Delete .anvil.lock to force fresh init.`,
    );
  }

  if (result.status === "in-progress") {
    if (ctx.nonInteractive) {
      throw new IncompleteLockfileError();
    }

    if (oldLockfile.version !== ctx.anvilVersion) {
      throw new Error(
        `Cannot resume: lockfile written by anvil ${oldLockfile.version}, current version is ${ctx.anvilVersion}. Resuming would mix old written files with newly-rendered template output. Run \`anvil doctor\` for reconciliation guidance.`,
      );
    }
  }

  return oldLockfile;
}

async function readSourceText(sourcePath: string): Promise<string> {
  const absolutePath = resolveSourcePath(sourcePath);

  return withScaffoldErrorContext(`Failed to read scaffold source "${sourcePath}"`, () =>
    Bun.file(absolutePath).text(),
  );
}

async function renderTemplate(entry: ManifestEntry, ctx: ScaffoldContext): Promise<string> {
  const absolutePath = resolveSourcePath(entry.src);
  const template = await withScaffoldErrorContext(`Failed to read scaffold template "${entry.src}"`, () =>
    Bun.file(absolutePath).text(),
  );

  return withScaffoldErrorContext(`Failed to render scaffold template "${entry.src}"`, () =>
    ejs.render(template, ctx, { filename: absolutePath }),
  );
}

async function listFilesRecursive(directoryPath: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const files: Array<{ absolutePath: string; relativePath: string }> = [];

  async function visit(currentPath: string): Promise<void> {
    const entries: Dirent[] = await withScaffoldErrorContext(
      `Failed to read scaffold source directory "${currentPath}"`,
      () => readdir(currentPath, { withFileTypes: true }),
    );

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (entry.isFile()) {
        files.push({
          absolutePath: entryPath,
          relativePath: toPosixPath(path.relative(directoryPath, entryPath)),
        });
      }
    }
  }

  await visit(directoryPath);
  return files;
}

async function addStaticGlob(entry: ManifestEntry, tree: FsTree): Promise<void> {
  const sourceBase = entry.src.slice(0, -globAllSuffix.length);
  const destBase = entry.dest.slice(0, -globAllSuffix.length);
  const absoluteSourceBase = resolveSourcePath(sourceBase);
  const files = await listFilesRecursive(absoluteSourceBase);

  for (const file of files) {
    const content = await readFile(file.absolutePath, "utf8");
    tree.write(path.posix.join(destBase, file.relativePath), content, "static");
  }
}

async function addManifestEntry(entry: ManifestEntry, ctx: ScaffoldContext, tree: FsTree): Promise<void> {
  switch (entry.source) {
    case "static":
      if (entry.src.endsWith(globAllSuffix) && entry.dest.endsWith(globAllSuffix)) {
        await addStaticGlob(entry, tree);
        return;
      }

      tree.write(entry.dest, await readSourceText(entry.src), entry.source);
      return;

    case "template":
      tree.write(entry.dest, await renderTemplate(entry, ctx), entry.source);
      return;

    case "generator":
      throw new Error(`Scaffold generator is not implemented for "${entry.src}" (${entry.dest}).`);

    default: {
      const exhaustive: never = entry.source;
      throw new Error(`Unsupported scaffold source: ${String(exhaustive)}`);
    }
  }
}

async function buildTree(ctx: ScaffoldContext, getManifest: ManifestProvider): Promise<BuiltTree> {
  const tree = new FsTree();
  const filesSkipped: string[] = [];
  const manifest = getManifest(ctx.lang);

  for (const entry of manifest.entries) {
    if (entry.when?.(ctx) === false) {
      filesSkipped.push(entry.dest);
      continue;
    }

    await addManifestEntry(entry, ctx, tree);
  }

  return { tree, filesSkipped };
}

function treeEntryMap(tree: FsTree): Map<string, FsTreeEntry> {
  return new Map(tree.entries().map((entry) => [entry.path, entry]));
}

function contentForChange(treeEntries: Map<string, FsTreeEntry>, change: FsTreeChange): string {
  const entry = treeEntries.get(change.path);
  if (entry === undefined) {
    throw new Error(`Cannot resolve scaffold change for missing FsTree entry: ${change.path}`);
  }

  return entry.content;
}

async function conflictDetails(
  ctx: ScaffoldContext,
  treeEntries: Map<string, FsTreeEntry>,
  change: FsTreeChange,
): Promise<ConflictReport["updates"][number]> {
  return {
    path: change.path,
    existingContent: await readFile(path.join(ctx.targetDir, change.path), "utf8"),
    newContent: contentForChange(treeEntries, change),
  };
}

function validateConflictResult(change: FsTreeChange, result: ConflictResult): void {
  if (result.path !== change.path) {
    throw new Error(`Conflict result path mismatch: expected "${change.path}", received "${result.path}".`);
  }
}

async function resolveInteractiveConflicts(
  ctx: ScaffoldContext,
  options: ScaffoldOptions,
  changes: FsTreeChange[],
  treeEntries: Map<string, FsTreeEntry>,
): Promise<ConflictDecision> {
  const updateChanges = changes.filter((change) => change.action === "update");
  const resolutions = new Map<string, ConflictResult["action"]>();

  for (const change of updateChanges) {
    const details = await conflictDetails(ctx, treeEntries, change);
    const result = await options.onConflict!(details.path, details.existingContent, details.newContent);
    validateConflictResult(change, result);
    resolutions.set(change.path, result.action);
  }

  if ([...resolutions.values()].includes("abort")) {
    throw new Error("Scaffold aborted by user.");
  }

  const filesSkipped = [...resolutions.entries()]
    .filter(([, action]) => action === "skip")
    .map(([filePath]) => filePath);
  const approvedChanges = changes.filter((change) => {
    if (change.action === "create") {
      return true;
    }

    if (change.action === "update") {
      return resolutions.get(change.path) === "overwrite";
    }

    return false;
  });

  return { approvedChanges, filesSkipped };
}

async function resolveNonInteractiveConflicts(
  ctx: ScaffoldContext,
  options: ScaffoldOptions,
  changes: FsTreeChange[],
  treeEntries: Map<string, FsTreeEntry>,
): Promise<ConflictDecision> {
  const updateChanges = changes.filter((change) => change.action === "update");

  if (updateChanges.length > 0) {
    const report: ConflictReport = {
      updates: [],
    };

    for (const change of updateChanges) {
      report.updates.push(await conflictDetails(ctx, treeEntries, change));
    }

    await options.onReport!(report);
    throw new ScaffoldConflictError(updateChanges.length);
  }

  return {
    approvedChanges: changes.filter((change) => change.action === "create"),
    filesSkipped: [],
  };
}

async function resolveConflicts(
  ctx: ScaffoldContext,
  options: ScaffoldOptions,
  changes: FsTreeChange[],
  treeEntries: Map<string, FsTreeEntry>,
): Promise<ConflictDecision> {
  if (ctx.nonInteractive) {
    return resolveNonInteractiveConflicts(ctx, options, changes, treeEntries);
  }

  return resolveInteractiveConflicts(ctx, options, changes, treeEntries);
}

function lockfileInputs(
  tree: FsTree,
  skippedConflictPaths: ReadonlySet<string>,
): Array<{ path: string; content: string }> {
  return tree
    .entries()
    .filter((entry) => !skippedConflictPaths.has(entry.path))
    .map((entry) => ({
      path: entry.path,
      content: entry.content,
    }));
}

function withPreservedCreationTime(lockfile: AnvilLockfile, oldLockfile: AnvilLockfile | null): AnvilLockfile {
  if (oldLockfile === null) {
    return lockfile;
  }

  return {
    ...lockfile,
    createdAt: oldLockfile.createdAt,
  };
}

function withPreservedSkippedEntries(
  lockfile: AnvilLockfile,
  oldLockfile: AnvilLockfile | null,
  skippedConflictPaths: ReadonlySet<string>,
): AnvilLockfile {
  if (oldLockfile === null || skippedConflictPaths.size === 0) {
    return lockfile;
  }

  const trackedPaths = new Set(lockfile.files.map((entry) => entry.path));
  const preservedEntries = oldLockfile.files
    .filter((entry) => skippedConflictPaths.has(entry.path) && !trackedPaths.has(entry.path))
    .map((entry) => ({ ...entry, status: "written" as const }));

  if (preservedEntries.length === 0) {
    return lockfile;
  }

  return {
    ...lockfile,
    files: [...lockfile.files, ...preservedEntries].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
}

function buildCompleteLockfile(
  ctx: ScaffoldContext,
  tree: FsTree,
  oldLockfile: AnvilLockfile | null,
  skippedConflictPaths: ReadonlySet<string>,
): AnvilLockfile {
  return withPreservedSkippedEntries(
    withPreservedCreationTime(
      createLockfile(ctx, lockfileInputs(tree, skippedConflictPaths)),
      oldLockfile,
    ),
    oldLockfile,
    skippedConflictPaths,
  );
}

function sameContext(left: AnvilLockfile["context"], right: AnvilLockfile["context"]): boolean {
  return (
    left.projectName === right.projectName &&
    left.packageManager === right.packageManager &&
    left.defaultBranch === right.defaultBranch &&
    left.sourceDir === right.sourceDir &&
    left.skipSeed === right.skipSeed &&
    left.year === right.year
  );
}

function sameToolchain(left: AnvilLockfile["toolchain"], right: AnvilLockfile["toolchain"]): boolean {
  return (
    left.bun === right.bun &&
    left.node === right.node &&
    left.go === right.go &&
    left.python === right.python
  );
}

function sameFiles(left: AnvilLockfile["files"], right: AnvilLockfile["files"]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.checksum === other.checksum &&
      entry.status === other.status
    );
  });
}

function sameCompleteLockfile(left: AnvilLockfile, right: AnvilLockfile): boolean {
  return (
    left.version === right.version &&
    left.lang === right.lang &&
    left.flushStatus === "complete" &&
    right.flushStatus === "complete" &&
    sameContext(left.context, right.context) &&
    sameToolchain(left.toolchain, right.toolchain) &&
    sameFiles(left.files, right.files)
  );
}

async function markAlreadyWrittenEntries(
  ctx: ScaffoldContext,
  lockfile: AnvilLockfile,
  dataWritePaths: ReadonlySet<string>,
): Promise<AnvilLockfile> {
  let current = lockfile;

  for (const entry of lockfile.files) {
    if (!dataWritePaths.has(entry.path)) {
      current = await markEntryWritten(ctx.targetDir, current, entry.path);
    }
  }

  return current;
}

async function flushWithCheckpoint(
  ctx: ScaffoldContext,
  tree: FsTree,
  oldLockfile: AnvilLockfile | null,
  approvedChanges: FsTreeChange[],
  skippedConflictPaths: ReadonlySet<string>,
): Promise<{ filesCreated: string[]; lockfile: AnvilLockfile }> {
  const completeLockfile = buildCompleteLockfile(ctx, tree, oldLockfile, skippedConflictPaths);
  const dataChanges = approvedChanges.filter(
    (change) => change.action === "create" || change.action === "update",
  );
  const dataWritePaths = new Set(dataChanges.map((change) => change.path));

  if (dataChanges.length === 0) {
    if (oldLockfile !== null && sameCompleteLockfile(oldLockfile, completeLockfile)) {
      return { filesCreated: [], lockfile: oldLockfile };
    }

    await writeLockfile(ctx.targetDir, completeLockfile);
    return { filesCreated: [], lockfile: completeLockfile };
  }

  let checkpoint = await writeLockfileCheckpoint(ctx.targetDir, completeLockfile);
  checkpoint = await markAlreadyWrittenEntries(ctx, checkpoint, dataWritePaths);

  const filesCreated: string[] = [];
  for (const change of dataChanges) {
    await flushChanges([change], tree, ctx.targetDir);
    checkpoint = await markEntryWritten(ctx.targetDir, checkpoint, change.path);
    filesCreated.push(change.path);
  }

  return {
    filesCreated,
    lockfile: await finalizeLockfile(ctx.targetDir, checkpoint),
  };
}

export async function scaffold(ctx: ScaffoldContext, options: ScaffoldOptions): Promise<ScaffoldResult> {
  validateOptions(ctx, options);

  const lockfileResult = await readLockfile(ctx.targetDir);
  const oldLockfile = validateLockfileStatus(ctx, lockfileResult);
  const { tree, filesSkipped: conditionSkipped } = await buildTree(ctx, options.getManifest ?? getDefaultManifest);
  const changes = await tree.listChanges(ctx.targetDir);
  const entriesByPath = treeEntryMap(tree);
  const conflictDecision = await resolveConflicts(ctx, options, changes, entriesByPath);
  const conflictSkipped = new Set(conflictDecision.filesSkipped);
  const flushResult = await flushWithCheckpoint(
    ctx,
    tree,
    oldLockfile,
    conflictDecision.approvedChanges,
    conflictSkipped,
  );

  return {
    filesCreated: flushResult.filesCreated,
    filesSkipped: [...conditionSkipped, ...conflictDecision.filesSkipped],
    lockfile: flushResult.lockfile,
  };
}

export async function previewScaffold(
  ctx: ScaffoldContext,
  options: ScaffoldPreviewOptions = {},
): Promise<ScaffoldPreviewResult> {
  const lockfileResult = await readLockfile(ctx.targetDir);
  const oldLockfile = validateLockfileStatus(ctx, lockfileResult);
  const { tree, filesSkipped } = await buildTree(ctx, options.getManifest ?? getDefaultManifest);

  return {
    changes: await tree.listChanges(ctx.targetDir),
    filesSkipped,
    lockfile: oldLockfile,
  };
}
