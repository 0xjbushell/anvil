import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { compare } from "../internal/dir-compare/index.ts";
import type { Scenario } from "./schema.ts";

export interface AssertionContext {
  workdir: string;
  inputDir: string;
  exit_code: number;
  stdout: string;
  stderr: string;
}

type Expect = Scenario["expect"];
type ResolvedWorkdirPath = { path: string } | { failure: string };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function resolveWorkdirPath(
  context: AssertionContext,
  key: keyof Expect,
  relativePath: string,
): ResolvedWorkdirPath {
  if (path.isAbsolute(relativePath)) {
    return {
      failure: `${key}: ${quoted(relativePath)} must be relative to the scenario workdir`,
    };
  }

  const resolvedPath = path.resolve(context.workdir, relativePath);
  const relativeToWorkdir = path.relative(context.workdir, resolvedPath);
  if (relativeToWorkdir.startsWith("..") || path.isAbsolute(relativeToWorkdir)) {
    return {
      failure: `${key}: ${quoted(relativePath)} resolves outside the scenario workdir`,
    };
  }

  return { path: resolvedPath };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readWorkdirFile(
  context: AssertionContext,
  key: keyof Expect,
  relativePath: string,
): Promise<{ contents: string } | { failure: string }> {
  const resolved = resolveWorkdirPath(context, key, relativePath);
  if ("failure" in resolved) return { failure: resolved.failure };

  try {
    return { contents: await readFile(resolved.path, "utf8") };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { failure: `${key}: ${quoted(relativePath)} could not be read: ${reason}` };
  }
}

export function assertExitCode(expected: number, context: AssertionContext): string[] {
  if (context.exit_code === expected) return [];
  return [`exit_code: expected ${expected}, got ${context.exit_code}`];
}

export async function assertFilesExist(paths: string[], context: AssertionContext): Promise<string[]> {
  const failures: string[] = [];
  for (const relativePath of paths) {
    const resolved = resolveWorkdirPath(context, "files_exist", relativePath);
    if ("failure" in resolved) {
      failures.push(resolved.failure);
      continue;
    }

    if (!(await exists(resolved.path))) {
      failures.push(`files_exist: expected ${quoted(relativePath)} to exist`);
    }
  }

  return failures;
}

export async function assertFilesAbsent(paths: string[], context: AssertionContext): Promise<string[]> {
  const failures: string[] = [];
  for (const relativePath of paths) {
    const resolved = resolveWorkdirPath(context, "files_absent", relativePath);
    if ("failure" in resolved) {
      failures.push(resolved.failure);
      continue;
    }

    if (await exists(resolved.path)) {
      failures.push(`files_absent: expected ${quoted(relativePath)} to be absent`);
    }
  }

  return failures;
}

export async function assertFilesContain(
  entries: NonNullable<Expect["files_contain"]>,
  context: AssertionContext,
): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of entries) {
    const readResult = await readWorkdirFile(context, "files_contain", entry.file);
    if ("failure" in readResult) {
      failures.push(readResult.failure);
      continue;
    }

    if (!readResult.contents.includes(entry.matches)) {
      failures.push(`files_contain: ${quoted(entry.file)} does not contain ${quoted(entry.matches)}`);
    }
  }

  return failures;
}

export async function assertFilesMatchRegex(
  entries: NonNullable<Expect["files_match_regex"]>,
  context: AssertionContext,
): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of entries) {
    let regex: RegExp;
    try {
      regex = new RegExp(entry.pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`files_match_regex: ${quoted(entry.file)} has invalid pattern ${quoted(entry.pattern)}: ${reason}`);
      continue;
    }

    const readResult = await readWorkdirFile(context, "files_match_regex", entry.file);
    if ("failure" in readResult) {
      failures.push(readResult.failure);
      continue;
    }

    if (!regex.test(readResult.contents)) {
      failures.push(`files_match_regex: ${quoted(entry.file)} does not match pattern ${quoted(entry.pattern)}`);
    }
  }

  return failures;
}

export function assertStdoutContains(expected: string[], context: AssertionContext): string[] {
  return expected
    .filter((substring) => !context.stdout.includes(substring))
    .map((substring) => `stdout_contains: stdout does not contain ${quoted(substring)}`);
}

export function assertStderrContains(expected: string[], context: AssertionContext): string[] {
  return expected
    .filter((substring) => !context.stderr.includes(substring))
    .map((substring) => `stderr_contains: stderr does not contain ${quoted(substring)}`);
}

export function assertStdoutEmpty(expected: boolean, context: AssertionContext): string[] {
  const actual = context.stdout.length === 0;
  if (actual === expected) return [];

  return [
    expected
      ? `stdout_empty: expected stdout to be empty, got ${context.stdout.length} bytes`
      : "stdout_empty: expected stdout not to be empty",
  ];
}

export function assertStderrEmpty(expected: boolean, context: AssertionContext): string[] {
  const actual = context.stderr.length === 0;
  if (actual === expected) return [];

  return [
    expected
      ? `stderr_empty: expected stderr to be empty, got ${context.stderr.length} bytes`
      : "stderr_empty: expected stderr not to be empty",
  ];
}

export async function assertFilesUnchangedFromInput(
  expected: boolean,
  context: AssertionContext,
): Promise<string[]> {
  const result = await compare(context.inputDir, context.workdir, { compareContent: true });
  if (result.same === expected) return [];

  if (!expected) {
    return ["files_unchanged_from_input: expected workdir to differ from input, but no differences were found"];
  }

  const details = result.diffSet
    .filter((entry) => entry.state !== "equal")
    .slice(0, 5)
    .map((entry) => {
      const reason = entry.reason ? ` (${entry.reason})` : "";
      return `${entry.relativePath}: ${entry.state}${reason}`;
    })
    .join(", ");
  const suffix = details.length > 0 ? `: ${details}` : "";

  return [`files_unchanged_from_input: expected workdir to match input, found ${result.differences} differences${suffix}`];
}

export async function evaluateAssertions(expect: Expect, context: AssertionContext): Promise<string[]> {
  const failures: string[] = [];

  if (expect.exit_code !== undefined) {
    failures.push(...assertExitCode(expect.exit_code, context));
  }
  if (expect.files_exist !== undefined) {
    failures.push(...(await assertFilesExist(expect.files_exist, context)));
  }
  if (expect.files_absent !== undefined) {
    failures.push(...(await assertFilesAbsent(expect.files_absent, context)));
  }
  if (expect.files_contain !== undefined) {
    failures.push(...(await assertFilesContain(expect.files_contain, context)));
  }
  if (expect.files_match_regex !== undefined) {
    failures.push(...(await assertFilesMatchRegex(expect.files_match_regex, context)));
  }
  if (expect.stdout_contains !== undefined) {
    failures.push(...assertStdoutContains(expect.stdout_contains, context));
  }
  if (expect.stderr_contains !== undefined) {
    failures.push(...assertStderrContains(expect.stderr_contains, context));
  }
  if (expect.stdout_empty !== undefined) {
    failures.push(...assertStdoutEmpty(expect.stdout_empty, context));
  }
  if (expect.stderr_empty !== undefined) {
    failures.push(...assertStderrEmpty(expect.stderr_empty, context));
  }
  if (expect.files_unchanged_from_input !== undefined) {
    failures.push(...(await assertFilesUnchangedFromInput(expect.files_unchanged_from_input, context)));
  }

  return failures;
}
