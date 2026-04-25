// ─── Scaffold context ────────────────────────────────────────────────
export type Lang = 'typescript' | 'golang' | 'python';
export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export interface ToolchainVersions {
  // Resolved at init time per D-64; only languages present in the project are populated.
  bun?: string;       // present whenever anvil itself runs (always)
  node?: string;      // typescript projects
  go?: string;        // golang projects
  python?: string;    // python projects
}

export interface ScaffoldContext {
  projectName: string;
  lang: Lang;
  targetDir: string;
  hasExistingCode: boolean;     // detection result
  skipSeed: boolean;            // authoritative; on re-scaffold loaded from lockfile.context.skipSeed
  sourceDir?: string;
  packageManager?: PackageManager;  // TS/JS only
  defaultBranch: string;        // 'main' default
  nonInteractive: boolean;      // --non-interactive flag only (explicit opt-in; D-67 supersedes D-56)
  toolchain: ToolchainVersions; // resolved at init per D-64; recorded in lockfile
  anvilVersion: string;         // from package.json
}

// ─── Manifest ────────────────────────────────────────────────────────
export type FileSource = 'static' | 'template' | 'generator';

export interface ManifestEntry {
  src: string;                  // path within static/<lang>/ (for static/template) or generator id
  dest: string;                 // target path relative to ScaffoldContext.targetDir
  source: FileSource;
  when?: (ctx: ScaffoldContext) => boolean;   // optional include predicate
}

export interface LanguageManifest {
  lang: Lang;
  entries: ManifestEntry[];
}

// ─── FsTree (D-40) ───────────────────────────────────────────────────
export type FsTreeAction = 'create' | 'update' | 'unchanged';

export interface FsTreeEntry {
  path: string;                 // relative to targetDir; posix-normalized
  content: string;              // text only in v1 — no Buffer/binary support
  source: FileSource;
}

export interface FsTreeChange {
  path: string;
  action: FsTreeAction;
}

// ─── Conflict resolution (re-scaffold prompt — interactive only) ─────
export type ConflictAction = 'overwrite' | 'skip' | 'abort';

export interface ConflictResult {
  path: string;
  action: ConflictAction;
}

export type ConflictHandler = (
  path: string,
  existingContent: string,
  newContent: string,
) => Promise<ConflictResult>;

// ─── Conflict reporter (non-interactive — D-67) ──────────────────────
// In --non-interactive mode the engine does NOT call ConflictHandler per file.
// Instead the engine collects all UPDATE entries, hands the changeset to the
// reporter, and exits non-zero with no files written (all-or-nothing).
export interface ConflictReport {
  updates: Array<{ path: string; existingContent: string; newContent: string }>;
  // Reporter renders unified diffs to stderr and is responsible for the exit-1 contract.
}

// ─── Lockfile (.anvil.lock) ──────────────────────────────────────────
export interface LockfileEntry {
  path: string;
  checksum: string;             // 'sha256:<64-hex>'
  source: FileSource;
}

export interface AnvilLockfile {
  version: string;              // anvil version that generated the project
  lang: Lang;
  context: {
    projectName: string;
    packageManager?: PackageManager;
    defaultBranch: string;
    sourceDir?: string;
    skipSeed: boolean;          // authoritative on re-scaffold
  };
  toolchain: ToolchainVersions; // resolved at init per D-64
  files: LockfileEntry[];
  createdAt: string;            // ISO 8601
  updatedAt: string;            // ISO 8601
}
