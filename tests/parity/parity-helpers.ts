import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "bun:test";
import { ESLint } from "eslint";

import {
  assertRequiredTools,
  commandRequirement,
  formatRequiredToolsError,
  python311Requirement,
} from "../support/required-tools.ts";

const require = createRequire(import.meta.url);
const parser = require("@typescript-eslint/parser");
const anvilPlugin = require("../../static/typescript/tools/lint-rules/plugin.js");

const repoRoot = path.resolve(import.meta.dir, "../..");
const goAnalyzerRoot = path.join(repoRoot, "static/golang/tools/go-analyzers");
const pythonPluginRoot = path.join(repoRoot, "static/python/tools/flake8-plugin");
const commandTimeoutMs = 120_000;
const goAnalyzerNames = [
  "nologcontinue",
  "noerrorobscuring",
  "noplaceholder",
  "nologthrow",
  "nosilenterrorswallow",
  "nopassthrough",
  "structuredlog",
  "requiretests",
  "filelength",
  "noexportedfunctionexpressions",
  "noemptytest",
  "notautological",
  "nodisabledtest",
  "requireerrortest",
] as const satisfies readonly string[];
const goAnalyzerNameSet = new Set<string>(goAnalyzerNames);

export interface LintResult {
  ruleId: string;
  message: string;
  line: number;
  column: number;
}

export interface RuleFixture {
  code: string;
  filename?: string;
  extraFiles?: Record<string, string>;
}

export interface TypeScriptRuleFixture extends RuleFixture {
  ruleOptions?: unknown[];
}

export interface PythonRuleFixture extends RuleFixture {
  sourceDirs?: string[];
}

interface GoodFixtureFields {
  goodCode?: string;
  goodFilename?: string;
  goodExtraFiles?: Record<string, string>;
}

export type ParityRuleFixture = RuleFixture & GoodFixtureFields;
export type TypeScriptParityFixture = TypeScriptRuleFixture & GoodFixtureFields;
export type PythonParityFixture = PythonRuleFixture & GoodFixtureFields;

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

let goAnalyzerBinary: string | undefined;
let goAnalyzerTempDir: string | undefined;

export function source(value: string): string {
  const trimmed = value.replace(/^\n/, "").replace(/\n\s*$/, "\n");
  const lines = trimmed.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const indent = indents.length === 0 ? 0 : Math.min(...indents);

  return lines.map((line) => line.slice(indent)).join("\n");
}

export function requireGoAnalyzer(): void {
  if (goAnalyzerBinary !== undefined) {
    return;
  }

  assertRequiredTools("Go parity", [commandRequirement("go")], {
    cwd: repoRoot,
    nixEntrypoint: "bun run nix:test -- tests/parity",
  });

  const tempDir = mkdtempSync(path.join(tmpdir(), "anvil-parity-vettool-"));
  const binaryPath = path.join(tempDir, "anvil-lint");
  const build = runCommand("go", ["build", "-o", binaryPath, "./cmd/anvil-lint"], goAnalyzerRoot);
  if (build.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(
      formatRequiredToolsError(
        "Go parity",
        [`go analyzer build failed: ${build.stderr || build.stdout}`],
        "bun run nix:test -- tests/parity",
      ),
    );
  }

  goAnalyzerBinary = binaryPath;
  goAnalyzerTempDir = tempDir;
}

export function requirePythonParityTools(): void {
  assertRequiredTools("Python parity", [python311Requirement(), commandRequirement("uv")], {
    cwd: repoRoot,
    nixEntrypoint: "bun run nix:test -- tests/parity",
  });
}

export async function runEslintRule(
  ruleId: string,
  fixture: TypeScriptRuleFixture,
): Promise<LintResult[]> {
  return withWorkspaceAsync(
    "anvil-parity-ts-",
    fixture,
    "src/parity.ts",
    async (workspace, entryPath) => {
      const eslint = new ESLint({
        cwd: workspace,
        overrideConfigFile: true,
        overrideConfig: [
          {
            files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
            languageOptions: {
              parser,
              parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
              },
            },
            plugins: { anvil: anvilPlugin },
            rules: {
              [ruleId]: fixture.ruleOptions === undefined ? "error" : ["error", ...fixture.ruleOptions],
            },
          },
        ],
      });
      const results = await eslint.lintFiles([entryPath]);

      return results.flatMap((result) =>
        result.messages
          .filter((message) => message.ruleId === ruleId)
          .map((message) => ({
            ruleId,
            message: message.message,
            line: message.line,
            column: message.column,
          })),
      );
    },
  );
}

export function runGoAnalyzer(analyzerName: string, fixture: RuleFixture): LintResult[] {
  return withWorkspace("anvil-parity-go-", fixture, "parity.go", (workspace) => {
    if (goAnalyzerBinary === undefined) {
      throw new Error("Go analyzer gate must run before Go parity checks.");
    }

    writeFixtureFile(workspace, "go.mod", "module parity.test\n\ngo 1.23\n");

    const result = runCommand(
      "go",
      ["vet", `-vettool=${goAnalyzerBinary}`, ...goAnalyzerFlags(analyzerName), "./..."],
      workspace,
    );
    const findings = parseGoVetOutput(analyzerName, `${result.stdout}\n${result.stderr}`);
    if (result.error !== undefined || (result.status !== 0 && findings.length === 0)) {
      throw new Error(commandFailure("go vet parity run", result));
    }

    return findings;
  });
}

export function runFlake8Rule(anvCode: string, fixture: PythonRuleFixture): LintResult[] {
  return withWorkspace("anvil-parity-py-", fixture, "src/parity.py", (workspace, entryPath) => {
    const sourceDirs = fixture.sourceDirs ?? ["src"];
    const result = runCommand(
      "uv",
      [
        "run",
        "--with",
        "flake8",
        "--with-editable",
        pythonPluginRoot,
        "python",
        "-m",
        "flake8",
        "--isolated",
        `--select=${anvCode}`,
        `--anvil-source-dir=${sourceDirs.join(",")}`,
        entryPath,
      ],
      workspace,
    );
    const findings = parseFlake8Output(anvCode, `${result.stdout}\n${result.stderr}`);
    if (result.error !== undefined || (result.status !== 0 && findings.length === 0)) {
      throw new Error(commandFailure("flake8 parity run", result));
    }

    return findings;
  });
}

export function goodFixture<T extends ParityRuleFixture>(fixture: T): T {
  return {
    ...fixture,
    code: fixture.goodCode ?? fixture.code,
    filename: fixture.goodFilename ?? fixture.filename,
    extraFiles: fixture.goodExtraFiles ?? fixture.extraFiles,
  };
}

export function expectFinding(findings: Pick<LintResult, "message">[], messagePattern: RegExp): void {
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.some((finding) => messagePattern.test(finding.message))).toBe(true);
}

function withWorkspace<T>(
  prefix: string,
  fixture: RuleFixture,
  defaultFilename: string,
  operation: (workspace: string, entryPath: string) => T,
): T {
  const workspace = mkdtempSync(path.join(tmpdir(), prefix));
  const filename = fixture.filename ?? defaultFilename;
  const entryPath = writeFixtureFile(workspace, filename, fixture.code);

  try {
    for (const [relativePath, content] of Object.entries(fixture.extraFiles ?? {})) {
      writeFixtureFile(workspace, relativePath, content);
    }
    return operation(workspace, entryPath);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function withWorkspaceAsync<T>(
  prefix: string,
  fixture: RuleFixture,
  defaultFilename: string,
  operation: (workspace: string, entryPath: string) => Promise<T>,
): Promise<T> {
  const workspace = mkdtempSync(path.join(tmpdir(), prefix));
  const filename = fixture.filename ?? defaultFilename;
  const entryPath = writeFixtureFile(workspace, filename, fixture.code);

  try {
    for (const [relativePath, content] of Object.entries(fixture.extraFiles ?? {})) {
      writeFixtureFile(workspace, relativePath, content);
    }
    return await operation(workspace, entryPath);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function writeFixtureFile(workspace: string, relativePath: string, content: string): string {
  const filePath = path.join(workspace, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return filePath;
}

function runCommand(command: string, args: string[], cwd: string, timeout = commandTimeoutMs): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      GOWORK: "off",
      PYTHONDONTWRITEBYTECODE: "1",
      UV_NO_PROGRESS: "1",
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function goAnalyzerFlags(analyzerName: string): string[] {
  if (!goAnalyzerNameSet.has(analyzerName)) {
    throw new Error(`Unknown Go analyzer: ${analyzerName}`);
  }

  return goAnalyzerNames.map((name) => `-${name}=${name === analyzerName ? "true" : "false"}`);
}

function parseGoVetOutput(ruleId: string, output: string): LintResult[] {
  return [
    ...parseGoVetTextOutput(ruleId, output),
    ...parseGoVetJsonOutput(ruleId, output),
  ];
}

function parseGoVetTextOutput(ruleId: string, output: string): LintResult[] {
  return output
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^(.*\.go):(\d+):(\d+):\s*(.+)$/);
      if (match === null) {
        return [];
      }

      return [
        {
          ruleId,
          line: Number(match[2]),
          column: Number(match[3]),
          message: match[4],
        },
      ];
    });
}

function parseGoVetJsonOutput(ruleId: string, output: string): LintResult[] {
  return extractJsonObjects(output).flatMap((jsonText) => {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isGoVetJson(parsed)) {
      return [];
    }

    const findings: LintResult[] = [];
    for (const packageDiagnostics of Object.values(parsed)) {
      const diagnostics = packageDiagnostics[ruleId] ?? [];
      for (const diagnostic of diagnostics) {
        const position = diagnostic.posn.match(/:(\d+):(\d+)$/);
        if (position === null) {
          continue;
        }
        findings.push({
          ruleId,
          line: Number(position[1]),
          column: Number(position[2]),
          message: diagnostic.message,
        });
      }
    }
    return findings;
  });
}

function extractJsonObjects(output: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(output.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function isGoVetJson(
  value: unknown,
): value is Record<string, Record<string, Array<{ posn: string; message: string }>>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (packageDiagnostics) =>
      typeof packageDiagnostics === "object" &&
      packageDiagnostics !== null &&
      !Array.isArray(packageDiagnostics) &&
      Object.values(packageDiagnostics).every(
        (diagnostics) =>
          Array.isArray(diagnostics) &&
          diagnostics.every(
            (diagnostic) =>
              typeof diagnostic === "object" &&
              diagnostic !== null &&
              "posn" in diagnostic &&
              typeof diagnostic.posn === "string" &&
              "message" in diagnostic &&
              typeof diagnostic.message === "string",
          ),
      ),
  );
}

function parseFlake8Output(ruleId: string, output: string): LintResult[] {
  return output
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^.*\.py:(\d+):(\d+):\s*(ANV\d{3})\s+(.+)$/);
      if (match === null || match[3] !== ruleId) {
        return [];
      }

      return [
        {
          ruleId,
          line: Number(match[1]),
          column: Number(match[2]),
          message: `${match[3]} ${match[4]}`,
        },
      ];
    });
}

function commandFailure(label: string, result: CommandResult): string {
  return `${label} failed\nstatus: ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

process.on("exit", () => {
  if (goAnalyzerTempDir !== undefined) {
    rmSync(goAnalyzerTempDir, { recursive: true, force: true });
  }
});
