import chalk from "chalk";
import path from "node:path";
import { readFile } from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { parse as parseYaml } from "yaml";

import pkg from "../../package.json" with { type: "json" };
import type { TextWriter } from "../scaffold/conflict-reporter.ts";
import {
  computeChecksum,
  isTextFile,
  normalizeForChecksum,
  readLockfile,
} from "../scaffold/lockfile.ts";
import type { AnvilLockfile, Lang, LockfileReadResult, PackageManager } from "../types.ts";
import { commandText, describeError, writeLine } from "./init-utils.ts";
import { runCommand, type CommandRunner } from "./init-post.ts";

export interface DoctorCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "fixed";
  message: string;
  fix?: string;
  instruction?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  exitCode: 0 | 1;
}

export interface DoctorDependencies {
  cwd?: () => string;
  stdout?: TextWriter;
  stderr?: TextWriter;
  runCommand?: CommandRunner;
  readLockfile?: typeof readLockfile;
  anvilVersion?: string;
}

interface ResolvedDoctorDependencies {
  cwd: () => string;
  stdout: TextWriter;
  stderr: TextWriter;
  runCommand: CommandRunner;
  readLockfile: typeof readLockfile;
  anvilVersion: string;
}

interface ToolRequirement {
  name: string;
  commands?: string[];
  required: boolean;
  instruction: string;
}

interface LockfileContext {
  result: LockfileReadResult;
  lockfile: AnvilLockfile | null;
}

const universalTools: ToolRequirement[] = [
  {
    name: "git",
    required: true,
    instruction: "Install Git: https://git-scm.com/downloads",
  },
  {
    name: "pre-commit",
    required: true,
    instruction: "Run: pip install pre-commit (or brew install pre-commit)",
  },
  {
    name: "gitleaks",
    required: true,
    instruction: "Install gitleaks: https://github.com/gitleaks/gitleaks#installing",
  },
];

const languageTools: Record<Lang, ToolRequirement[]> = {
  typescript: [
    { name: "node", required: true, instruction: "Install Node.js: https://nodejs.org" },
    { name: "bun", required: false, instruction: "Install Bun: https://bun.sh" },
  ],
  golang: [
    { name: "go", required: true, instruction: "Install Go: https://go.dev/dl/" },
    {
      name: "golangci-lint",
      required: true,
      instruction: "Run: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest",
    },
  ],
  python: [
    { name: "python", commands: ["python3", "python"], required: true, instruction: "Install Python: https://python.org" },
    { name: "uv", required: true, instruction: "Install uv: https://docs.astral.sh/uv/" },
    { name: "ruff", required: true, instruction: "Run: uv pip install ruff" },
  ],
};

const baseTypescriptProjectDeps = ["eslint", "prettier", "vitest", "knip", "typescript"];
const pythonProjectDeps = ["flake8", "mypy", "pytest", "pip-audit"];
const goProjectDeps = [
  { name: "deadcode", module: "golang.org/x/tools/cmd/deadcode" },
  { name: "govulncheck", module: "golang.org/x/vuln/cmd/govulncheck" },
];

const commonGitignoreEntries = [".env", ".DS_Store"];
const gitignoreEntriesByLang: Record<Lang, string[]> = {
  typescript: ["node_modules/", "dist/", "coverage/", ".stryker-tmp/"],
  golang: ["vendor/", "bin/", "tools/go-analyzers/bin/"],
  python: ["__pycache__/", ".venv/", "*.egg-info/", ".mypy_cache/", ".ruff_cache/", "htmlcov/"],
};

const newlineConfigFilesByLang: Record<Lang, string[]> = {
  typescript: ["Makefile", "eslint.config.mjs"],
  golang: ["Makefile", ".golangci.yml"],
  python: ["Makefile", "pyproject.toml"],
};

function resolveDependencies(deps: DoctorDependencies = {}): ResolvedDoctorDependencies {
  return {
    cwd: deps.cwd ?? (() => process.cwd()),
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    runCommand: deps.runCommand ?? runCommand,
    readLockfile: deps.readLockfile ?? readLockfile,
    anvilVersion: deps.anvilVersion ?? pkg.version,
  };
}

function check(
  name: string,
  status: DoctorCheck["status"],
  message: string,
  extras: Pick<DoctorCheck, "fix" | "instruction"> = {},
): DoctorCheck {
  return {
    name,
    status,
    message,
    ...extras,
  };
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  return file.text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLockfileForDoctor(targetDir: string, deps: ResolvedDoctorDependencies): Promise<LockfileContext> {
  const result = await deps.readLockfile(targetDir);
  if (result.status === "complete" || result.status === "in-progress") {
    return { result, lockfile: result.lockfile };
  }
  return { result, lockfile: null };
}

async function probeCommand(
  command: string,
  args: string[],
  targetDir: string,
  deps: ResolvedDoctorDependencies,
): Promise<{ succeeded: boolean; error: string | null }> {
  try {
    const result = await deps.runCommand(command, args, { cwd: targetDir });
    return { succeeded: result.exitCode === 0, error: null };
  } catch (error) {
    return { succeeded: false, error: describeError(error) };
  }
}

async function checkToolAvailability(
  requirement: ToolRequirement,
  targetDir: string,
  deps: ResolvedDoctorDependencies,
): Promise<DoctorCheck> {
  const probeErrors: string[] = [];
  for (const command of requirement.commands ?? [requirement.name]) {
    const result = await probeCommand("which", [command], targetDir, deps);
    if (result.succeeded) {
      return check(`tool: ${requirement.name}`, "pass", `${requirement.name} is available via ${command}`);
    }

    if (result.error !== null) {
      probeErrors.push(`${command}: ${result.error}`);
    }
  }

  const instruction =
    probeErrors.length === 0 ? requirement.instruction : `${requirement.instruction} Probe error: ${probeErrors.join("; ")}`;

  return check(
    `tool: ${requirement.name}`,
    requirement.required ? "fail" : "warn",
    `${requirement.name} is not available on PATH`,
    { instruction },
  );
}

function packageManagerListCommand(packageManager: PackageManager): { command: string; args: string[] } {
  switch (packageManager) {
    case "bun":
      return { command: "bun", args: ["pm", "ls"] };
    case "npm":
      return { command: "npm", args: ["ls", "--json", "--depth=0"] };
    case "pnpm":
      return { command: "pnpm", args: ["list", "--json", "--depth=0"] };
    case "yarn":
      return { command: "yarn", args: ["list"] };
  }
}

function typescriptProjectDeps(packageManager: PackageManager): string[] {
  if (packageManager === "bun") {
    return [...baseTypescriptProjectDeps, "better-npm-audit"];
  }

  return baseTypescriptProjectDeps;
}

function addJsonPackageNames(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      addJsonPackageNames(entry, names);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.name === "string") {
    names.add(value.name.toLowerCase());
  }

  if (isRecord(value.dependencies)) {
    for (const [name, metadata] of Object.entries(value.dependencies)) {
      names.add(name.toLowerCase());
      addJsonPackageNames(metadata, names);
    }
  }
}

function packageNameFromListingLine(line: string): string | null {
  const cleaned = line
    .trim()
    .replace(/^[├└]──\s*/, "")
    .replace(/^[├└]─\s*/, "")
    .replace(/^[-*]\s*/, "");
  const token = cleaned.split(/\s+/)[0];
  if (token === undefined || token.length === 0 || token.includes("node_modules") || token.startsWith("/")) {
    return null;
  }

  if (token.startsWith("@")) {
    const versionSeparator = token.lastIndexOf("@");
    return versionSeparator > 0 ? token.slice(0, versionSeparator).toLowerCase() : token.toLowerCase();
  }

  const versionSeparator = token.indexOf("@");
  return versionSeparator > 0 ? token.slice(0, versionSeparator).toLowerCase() : token.toLowerCase();
}

function packageNamesFromOutput(output: string): Set<string> {
  const names = new Set<string>();
  try {
    addJsonPackageNames(JSON.parse(output) as unknown, names);
  } catch {
    for (const line of output.split(/\r?\n/)) {
      const name = packageNameFromListingLine(line);
      if (name !== null) {
        names.add(name);
      }
    }
  }
  return names;
}

function dependencyOutputContains(output: string, dependency: string): boolean {
  return packageNamesFromOutput(output).has(dependency.toLowerCase());
}

function goModuleOutputContains(output: string, modulePath: string): boolean {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .some((moduleName) => moduleName === modulePath);
}

async function checkTypescriptProjectDeps(
  targetDir: string,
  deps: ResolvedDoctorDependencies,
  packageManager: PackageManager,
): Promise<DoctorCheck[]> {
  const probe = packageManagerListCommand(packageManager);
  const expectedDeps = typescriptProjectDeps(packageManager);
  let result: Awaited<ReturnType<CommandRunner>>;

  try {
    result = await deps.runCommand(probe.command, probe.args, { cwd: targetDir });
  } catch (error) {
    return expectedDeps.map((dependency) =>
      check(`typescript dependency: ${dependency}`, "fail", `${dependency} could not be verified`, {
        instruction: `${commandText(probe.command, probe.args)} failed (${describeError(error)}). Run ${packageManager} install.`,
      }),
    );
  }

  return expectedDeps.map((dependency) => {
    if (result.exitCode === 0 && dependencyOutputContains(result.stdout, dependency)) {
      return check(`typescript dependency: ${dependency}`, "pass", `${dependency} is installed`);
    }

    return check(`typescript dependency: ${dependency}`, "fail", `${dependency} is missing`, {
      instruction: `Run ${packageManager} install to restore project dependencies.`,
    });
  });
}

async function checkGoProjectDeps(targetDir: string, deps: ResolvedDoctorDependencies): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  let modules = "";

  try {
    const result = await deps.runCommand("go", ["list", "-m", "all"], { cwd: targetDir });
    modules = result.exitCode === 0 ? result.stdout : "";
  } catch (error) {
    for (const dependency of goProjectDeps) {
      checks.push(
        check(`golang dependency: ${dependency.name}`, "fail", `${dependency.name} could not be verified`, {
          instruction: `go list -m all failed (${describeError(error)}). Run go mod tidy.`,
        }),
      );
    }
    return [...checks, ...(await checkGoAnalyzer(targetDir, deps))];
  }

  for (const dependency of goProjectDeps) {
    checks.push(
      goModuleOutputContains(modules, dependency.module)
        ? check(`golang dependency: ${dependency.name}`, "pass", `${dependency.name} is declared`)
        : check(`golang dependency: ${dependency.name}`, "fail", `${dependency.name} is missing`, {
            instruction: "Run go mod tidy after restoring the scaffolded tools/tools.go.",
          }),
    );
  }

  return [...checks, ...(await checkGoAnalyzer(targetDir, deps))];
}

async function checkGoAnalyzer(targetDir: string, deps: ResolvedDoctorDependencies): Promise<DoctorCheck[]> {
  const analyzerPath = path.join(targetDir, "tools/go-analyzers/bin/anvil-lint");
  if (await Bun.file(analyzerPath).exists()) {
    return [check("golang dependency: anvil-lint", "pass", "anvil-lint binary exists")];
  }

  const build = await probeCommand("make", ["-C", "tools/go-analyzers", "build"], targetDir, deps);
  return [
    build.succeeded
      ? check("golang dependency: anvil-lint", "pass", "anvil-lint builds successfully")
      : check("golang dependency: anvil-lint", "fail", "anvil-lint is missing and could not be built", {
          instruction:
            build.error === null ? "Run make -C tools/go-analyzers build." : `make -C tools/go-analyzers build failed: ${build.error}`,
        }),
  ];
}

async function checkPythonProjectDeps(targetDir: string, deps: ResolvedDoctorDependencies): Promise<DoctorCheck[]> {
  let installed = "";

  try {
    const result = await deps.runCommand("uv", ["pip", "list", "--format=json"], { cwd: targetDir });
    installed = result.exitCode === 0 ? result.stdout : "";
  } catch (error) {
    return pythonProjectDeps.map((dependency) =>
      check(`python dependency: ${dependency}`, "fail", `${dependency} could not be verified`, {
        instruction: `uv pip list --format=json failed (${describeError(error)}). Run uv pip install -e .[dev].`,
      }),
    );
  }

  return pythonProjectDeps.map((dependency) =>
    dependencyOutputContains(installed, dependency)
      ? check(`python dependency: ${dependency}`, "pass", `${dependency} is installed`)
      : check(`python dependency: ${dependency}`, "fail", `${dependency} is missing`, {
          instruction: "Run uv pip install -e .[dev].",
        }),
  );
}

function npmToolForPackageManager(packageManager: PackageManager): ToolRequirement[] {
  if (packageManager !== "npm") {
    return [];
  }

  return [{ name: "npx", required: true, instruction: "Comes with Node.js - reinstall Node.js" }];
}

export async function checkTools(
  lang: Lang,
  targetDir: string,
  injectedDeps: DoctorDependencies = {},
  packageManager: PackageManager = "bun",
): Promise<DoctorCheck[]> {
  const deps = resolveDependencies(injectedDeps);
  const toolChecks = await Promise.all(
    [...universalTools, ...languageTools[lang], ...npmToolForPackageManager(packageManager)].map((requirement) =>
      checkToolAvailability(requirement, targetDir, deps),
    ),
  );

  if (lang === "typescript") {
    return [...toolChecks, ...(await checkTypescriptProjectDeps(targetDir, deps, packageManager))];
  }

  if (lang === "golang") {
    return [...toolChecks, ...(await checkGoProjectDeps(targetDir, deps))];
  }

  return [...toolChecks, ...(await checkPythonProjectDeps(targetDir, deps))];
}

async function configExists(name: string, targetDir: string, missingStatus: "fail" | "warn", instruction: string): Promise<DoctorCheck> {
  return (await Bun.file(path.join(targetDir, name)).exists())
    ? check(name, "pass", `${name} exists`)
    : check(name, missingStatus, `${name} is missing`, { instruction });
}

function makefileTargetCheck(makefile: string, target: string): DoctorCheck {
  const targetPattern = new RegExp(`^${target}\\s*:`, "m");
  return targetPattern.test(makefile)
    ? check(`Makefile target: ${target}`, "pass", `Makefile defines ${target}`)
    : check(`Makefile target: ${target}`, "warn", `Makefile is missing target ${target}`, {
        instruction: `Add a ${target} target or re-run anvil init to refresh the Makefile.`,
      });
}

async function checkUniversalConfigs(targetDir: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(await configExists("Makefile", targetDir, "fail", "Re-run anvil init to regenerate"));

  const makefile = await readTextIfExists(path.join(targetDir, "Makefile"));
  if (makefile !== null) {
    checks.push(...["lint", "test", "check", "format"].map((target) => makefileTargetCheck(makefile, target)));
  }

  checks.push(await configExists(".pre-commit-config.yaml", targetDir, "fail", "Re-run anvil init to regenerate"));
  const preCommitConfig = await readTextIfExists(path.join(targetDir, ".pre-commit-config.yaml"));
  if (preCommitConfig !== null) {
    try {
      parseYaml(preCommitConfig);
      checks.push(check(".pre-commit-config.yaml syntax", "pass", ".pre-commit-config.yaml is valid YAML"));
    } catch (error) {
      checks.push(
        check(".pre-commit-config.yaml syntax", "fail", ".pre-commit-config.yaml is not valid YAML", {
          instruction: `Fix the YAML syntax error: ${describeError(error)}`,
        }),
      );
    }
  }

  checks.push(await configExists(".gitignore", targetDir, "warn", "Run anvil doctor to create safe defaults"));

  const gitattributes = await readTextIfExists(path.join(targetDir, ".gitattributes"));
  if (gitattributes === null || !gitattributes.split(/\r?\n/).includes("* text=auto eol=lf")) {
    checks.push(
      check(".gitattributes", "warn", ".gitattributes missing or does not enforce LF", {
        instruction: "Run anvil init to refresh LF line-ending configuration.",
      }),
    );
  } else {
    checks.push(check(".gitattributes", "pass", ".gitattributes enforces LF"));
  }

  return checks;
}

async function checkTypescriptConfigs(targetDir: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [
    await configExists("eslint.config.mjs", targetDir, "fail", "Re-run anvil init to regenerate"),
    await configExists("tsconfig.json", targetDir, "warn", "Add tsconfig.json or re-run anvil init"),
  ];

  const packageJson = await readTextIfExists(path.join(targetDir, "package.json"));
  if (packageJson === null) {
    checks.push(check("package.json", "fail", "package.json is missing", { instruction: "Run anvil init to regenerate" }));
    return checks;
  }

  try {
    const parsed = JSON.parse(packageJson) as unknown;
    const hasModuleType = isRecord(parsed) && parsed.type === "module";
    checks.push(
      hasModuleType
        ? check("package.json type", "pass", 'package.json has "type": "module"')
        : check("package.json type", "warn", 'package.json is missing "type": "module"', {
            instruction: 'Add "type": "module" if this project uses ESM.',
          }),
    );
  } catch (error) {
    checks.push(
      check("package.json", "fail", "package.json is not valid JSON", {
        instruction: `Fix package.json syntax: ${describeError(error)}`,
      }),
    );
  }

  return checks;
}

async function checkGoConfigs(targetDir: string): Promise<DoctorCheck[]> {
  return [
    await configExists(".golangci.yml", targetDir, "fail", "Re-run anvil init to regenerate"),
    await configExists("go.mod", targetDir, "fail", "Run go mod init"),
    await configExists("tools/tools.go", targetDir, "warn", "Re-run anvil init to restore tool declarations"),
  ];
}

async function checkPythonConfigs(targetDir: string): Promise<DoctorCheck[]> {
  const checks = [await configExists("pyproject.toml", targetDir, "fail", "Re-run anvil init to regenerate")];
  const pyproject = await readTextIfExists(path.join(targetDir, "pyproject.toml"));
  if (pyproject !== null) {
    checks.push(
      /^\[tool\.ruff\]\s*$/m.test(pyproject)
        ? check("pyproject.toml [tool.ruff]", "pass", "pyproject.toml configures Ruff")
        : check("pyproject.toml [tool.ruff]", "warn", "pyproject.toml is missing [tool.ruff]", {
            instruction: "Add [tool.ruff] configuration.",
          }),
    );
  }

  return checks;
}

export async function checkConfigs(lang: Lang | null, targetDir: string): Promise<DoctorCheck[]> {
  const checks = await checkUniversalConfigs(targetDir);
  if (lang === "typescript") {
    return [...checks, ...(await checkTypescriptConfigs(targetDir))];
  }

  if (lang === "golang") {
    return [...checks, ...(await checkGoConfigs(targetDir))];
  }

  if (lang === "python") {
    return [...checks, ...(await checkPythonConfigs(targetDir))];
  }

  return checks;
}

function compareMajorVersions(left: string, right: string): "same" | "different" {
  const leftMajor = left.split(".")[0];
  const rightMajor = right.split(".")[0];
  return leftMajor === rightMajor ? "same" : "different";
}

async function buildLockfileChecks(
  targetDir: string,
  context: LockfileContext,
  anvilVersion: string,
): Promise<DoctorCheck[]> {
  const { result, lockfile } = context;
  if (result.status === "absent") {
    return [
      check(".anvil.lock", "warn", ".anvil.lock not found - run `anvil init` first to provision provenance.", {
        instruction: "Run `anvil init --lang <language>` to scaffold this project.",
      }),
    ];
  }

  if (result.status === "corrupt" || lockfile === null) {
    return [
      check(".anvil.lock", "fail", "Lockfile is corrupted - delete `.anvil.lock` and re-run `anvil init`.", {
        instruction: "Delete `.anvil.lock` and re-run `anvil init` to rebuild provenance.",
      }),
    ];
  }

  const checks: DoctorCheck[] = [check(".anvil.lock", "pass", ".anvil.lock is parseable")];

  if (lockfile.flushStatus === "in-progress") {
    const pending = lockfile.files.filter((entry) => entry.status === "pending").map((entry) => entry.path);
    checks.push(
      check(".anvil.lock checkpoint", "warn", "Previous init was interrupted.", {
        instruction:
          pending.length > 0
            ? `Pending entries: ${pending.join(", ")}. Re-run anvil init interactively to resume.`
            : "No pending entries remain. Re-run anvil init interactively to finalize.",
      }),
    );
  }

  for (const entry of lockfile.files) {
    const filePath = path.join(targetDir, entry.path);
    if (!(await Bun.file(filePath).exists())) {
      checks.push(
        check(`lockfile checksum: ${entry.path}`, "warn", `${entry.path} tracked in lockfile but missing from disk`, {
          instruction: "Re-run `anvil init` if the scaffolded file should be restored.",
        }),
      );
      continue;
    }

    const actualChecksum = computeChecksum(normalizeForChecksum(await readFile(filePath), isTextFile(entry.path)));
    if (actualChecksum !== entry.checksum) {
      checks.push(
        check(`lockfile checksum: ${entry.path}`, "warn", `${entry.path} has been modified since last anvil run`, {
          instruction: "No action required if this drift is intentional.",
        }),
      );
    }
  }

  if (lockfile.version === anvilVersion) {
    checks.push(check("anvil version", "pass", `Project was generated by anvil ${lockfile.version}`));
  } else if (compareMajorVersions(lockfile.version, anvilVersion) === "same") {
    checks.push(
      check("anvil version", "warn", `Project was generated by anvil ${lockfile.version}; current is ${anvilVersion}.`, {
        instruction: "Re-run `anvil init` to refresh tooling.",
      }),
    );
  } else {
    checks.push(
      check("anvil version", "warn", `Major version mismatch (${lockfile.version} -> ${anvilVersion}).`, {
        instruction: "Review CHANGELOG for breaking changes before re-running `anvil init`.",
      }),
    );
  }

  return checks;
}

export async function checkLockfile(
  targetDir: string,
  injectedDeps: DoctorDependencies = {},
): Promise<DoctorCheck[]> {
  const deps = resolveDependencies(injectedDeps);
  return buildLockfileChecks(targetDir, await readLockfileForDoctor(targetDir, deps), deps.anvilVersion);
}

function auditCommand(packageManager: PackageManager): { command: string; args: string[] } {
  switch (packageManager) {
    case "bun":
      return { command: "bunx", args: ["better-npm-audit", "audit"] };
    case "npm":
      return { command: "npm", args: ["audit"] };
    case "pnpm":
      return { command: "pnpm", args: ["audit"] };
    case "yarn":
      return { command: "yarn", args: ["audit"] };
  }
}

export async function checkAudit(
  lang: Lang | null,
  targetDir: string,
  injectedDeps: DoctorDependencies = {},
  packageManager: PackageManager = "bun",
): Promise<DoctorCheck[]> {
  if (lang !== "typescript") {
    return [];
  }

  const deps = resolveDependencies(injectedDeps);
  const probe = auditCommand(packageManager);
  try {
    const result = await deps.runCommand(probe.command, probe.args, { cwd: targetDir });
    if (result.exitCode === 0) {
      return [check("dependency audit", "pass", "dependency audit passed")];
    }

    return [
      check("dependency audit", "fail", `${commandText(probe.command, probe.args)} exited ${result.exitCode}`, {
        instruction: result.stderr.trim() || `Run ${commandText(probe.command, probe.args)} for details.`,
      }),
    ];
  } catch (error) {
    return [
      check("dependency audit", "fail", `${commandText(probe.command, probe.args)} could not run`, {
        instruction: describeError(error),
      }),
    ];
  }
}

async function writeTextAtomic(filePath: string, contents: string): Promise<void> {
  await writeFileAtomic(filePath, contents, "utf8");
}

function appendMissingLines(existing: string, missing: string[]): string {
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? `${existing}\n` : existing;
  return `${prefix}${missing.join("\n")}\n`;
}

async function checkAndFixGitignore(lang: Lang | null, targetDir: string): Promise<DoctorCheck> {
  const expected = [...(lang === null ? [] : gitignoreEntriesByLang[lang]), ...commonGitignoreEntries];
  const gitignorePath = path.join(targetDir, ".gitignore");
  const existing = await readTextIfExists(gitignorePath);
  const lines = new Set((existing ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = expected.filter((entry) => !lines.has(entry));

  if (missing.length === 0) {
    return check(".gitignore entries", "pass", ".gitignore contains expected entries");
  }

  await writeTextAtomic(gitignorePath, appendMissingLines(existing ?? "", missing));
  return check(".gitignore entries", "fixed", ".gitignore was missing safe ignore entries", {
    fix: `Added ${missing.join(", ")} to .gitignore`,
  });
}

async function checkAndFixTrailingNewlines(lang: Lang | null, targetDir: string): Promise<DoctorCheck[]> {
  const configFiles = lang === null ? ["Makefile"] : newlineConfigFilesByLang[lang];
  const checks: DoctorCheck[] = [];

  for (const relativePath of configFiles) {
    const filePath = path.join(targetDir, relativePath);
    const contents = await readTextIfExists(filePath);
    if (contents === null) {
      continue;
    }

    if (contents.endsWith("\n")) {
      checks.push(check(`trailing newline: ${relativePath}`, "pass", `${relativePath} ends with a newline`));
      continue;
    }

    await writeTextAtomic(filePath, `${contents}\n`);
    checks.push(
      check(`trailing newline: ${relativePath}`, "fixed", `${relativePath} was missing a trailing newline`, {
        fix: `Appended trailing newline to ${relativePath}`,
      }),
    );
  }

  return checks;
}

export async function checkAndFix(lang: Lang | null, targetDir: string): Promise<DoctorCheck[]> {
  return [await checkAndFixGitignore(lang, targetDir), ...(await checkAndFixTrailingNewlines(lang, targetDir))];
}

async function detectLanguage(targetDir: string, lockfile: AnvilLockfile | null): Promise<Lang | null> {
  if (lockfile !== null) {
    return lockfile.lang;
  }

  if (await Bun.file(path.join(targetDir, "go.mod")).exists()) {
    return "golang";
  }

  if (await Bun.file(path.join(targetDir, "package.json")).exists()) {
    return "typescript";
  }

  if (await Bun.file(path.join(targetDir, "pyproject.toml")).exists()) {
    return "python";
  }

  return null;
}

async function detectPackageManager(targetDir: string, lockfile: AnvilLockfile | null): Promise<PackageManager> {
  const locked = lockfile?.context.packageManager;
  if (locked !== undefined) {
    return locked;
  }

  const candidates: Array<{ packageManager: PackageManager; files: string[] }> = [
    { packageManager: "bun", files: ["bun.lock", "bun.lockb"] },
    { packageManager: "npm", files: ["package-lock.json"] },
    { packageManager: "pnpm", files: ["pnpm-lock.yaml"] },
    { packageManager: "yarn", files: ["yarn.lock"] },
  ];

  for (const candidate of candidates) {
    for (const fileName of candidate.files) {
      if (await Bun.file(path.join(targetDir, fileName)).exists()) {
        return candidate.packageManager;
      }
    }
  }

  return "bun";
}

function statusRank(status: DoctorCheck["status"]): number {
  switch (status) {
    case "pass":
      return 0;
    case "fixed":
      return 1;
    case "warn":
      return 2;
    case "fail":
      return 3;
  }
}

function statusLabel(status: DoctorCheck["status"]): string {
  switch (status) {
    case "pass":
      return "PASS";
    case "fixed":
      return "FIXED";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
  }
}

function colorStatus(status: DoctorCheck["status"], text: string): string {
  switch (status) {
    case "pass":
      return chalk.green(text);
    case "fixed":
      return chalk.blue(text);
    case "warn":
      return chalk.yellow(text);
    case "fail":
      return chalk.red(text);
  }
}

function printChecks(checks: DoctorCheck[], stdout: TextWriter): void {
  for (const status of ["pass", "fixed", "warn", "fail"] as const) {
    const group = checks
      .filter((candidate) => candidate.status === status)
      .sort((left, right) => left.name.localeCompare(right.name));
    if (group.length === 0) {
      continue;
    }

    writeLine(stdout, colorStatus(status, `${statusLabel(status)} (${group.length})`));
    for (const entry of group) {
      writeLine(stdout, `  ${entry.name}: ${entry.message}`);
      if (entry.fix !== undefined) {
        writeLine(stdout, `    fix: ${entry.fix}`);
      }
      if (entry.instruction !== undefined) {
        writeLine(stdout, `    -> ${entry.instruction}`);
      }
    }
    writeLine(stdout);
  }
}

function printSummary(checks: DoctorCheck[], stdout: TextWriter): void {
  const counts = new Map<DoctorCheck["status"], number>([
    ["pass", 0],
    ["fixed", 0],
    ["warn", 0],
    ["fail", 0],
  ]);

  for (const entry of checks) {
    counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  }

  writeLine(stdout, `${counts.get("pass") ?? 0} checks passed`);
  if ((counts.get("fixed") ?? 0) > 0) {
    writeLine(stdout, `${counts.get("fixed")} issues auto-fixed`);
  }
  if ((counts.get("warn") ?? 0) > 0) {
    writeLine(stdout, `${counts.get("warn")} warnings`);
  }
  if ((counts.get("fail") ?? 0) > 0) {
    writeLine(stdout, `${counts.get("fail")} issues need manual fix`);
  }
}

export async function runDoctor(injectedDeps: DoctorDependencies = {}): Promise<DoctorResult> {
  const deps = resolveDependencies(injectedDeps);
  const targetDir = path.resolve(deps.cwd());
  const lockfileContext = await readLockfileForDoctor(targetDir, deps);
  const lang = await detectLanguage(targetDir, lockfileContext.lockfile);
  const packageManager = await detectPackageManager(targetDir, lockfileContext.lockfile);

  const checks = [
    ...(await buildLockfileChecks(targetDir, lockfileContext, deps.anvilVersion)),
    ...(await checkToolsForDetectedLanguage(lang, targetDir, deps, packageManager)),
    ...(await checkConfigs(lang, targetDir)),
    ...(await checkAudit(lang, targetDir, deps, packageManager)),
    ...(await checkAndFix(lang, targetDir)),
  ].sort((left, right) => statusRank(left.status) - statusRank(right.status));

  printChecks(checks, deps.stdout);
  printSummary(checks, deps.stdout);

  return {
    checks,
    exitCode: checks.some((entry) => entry.status === "fail") ? 1 : 0,
  };
}

async function checkToolsForDetectedLanguage(
  lang: Lang | null,
  targetDir: string,
  deps: ResolvedDoctorDependencies,
  packageManager: PackageManager,
): Promise<DoctorCheck[]> {
  if (lang === null) {
    return Promise.all(universalTools.map((requirement) => checkToolAvailability(requirement, targetDir, deps)));
  }

  return checkTools(lang, targetDir, deps, packageManager);
}

export default async function doctor(injectedDeps: DoctorDependencies = {}): Promise<void> {
  const result = await runDoctor(injectedDeps);
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}
