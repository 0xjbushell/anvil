import chalk from "chalk";
import { diffLines, type Change } from "diff";

import type { ConflictReport } from "../types.ts";

export interface TextWriter {
  write(chunk: string): void;
}

function colorPatchLine(line: string): string {
  if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
    return line;
  }

  if (line.startsWith("-")) {
    return chalk.red(line);
  }

  if (line.startsWith("+")) {
    return chalk.green(line);
  }

  return chalk.dim(line);
}

function splitPreservingLineEndings(value: string): string[] {
  const withoutFinalEmpty = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (withoutFinalEmpty.length === 0) {
    return [];
  }

  return withoutFinalEmpty.split("\n").map((line, index, lines) => {
    const isLastLine = index === lines.length - 1;
    return isLastLine && !value.endsWith("\n") ? line : `${line}\n`;
  });
}

function renderDiffPart(part: Change): string {
  const prefix = part.added ? "+" : part.removed ? "-" : " ";
  return splitPreservingLineEndings(part.value)
    .map((line) => colorPatchLine(`${prefix}${line}`))
    .join("");
}

function renderPatch(path: string, existingContent: string, newContent: string): string {
  const body = diffLines(existingContent, newContent).map((part) => renderDiffPart(part)).join("");
  const rendered = `--- existing ${path}\n+++ new ${path}\n@@ -1 +1 @@\n${body}`;

  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

function conflictSummary(count: number): string {
  const noun = count === 1 ? "file differs" : "files differ";
  return `${count} ${noun} from current anvil templates. Re-run interactively (drop --non-interactive) to resolve, or update the source files.`;
}

export function createConflictReporter(stderr: TextWriter = process.stderr): (report: ConflictReport) => Promise<void> {
  return async (report) => {
    for (const update of report.updates) {
      stderr.write(renderPatch(update.path, update.existingContent, update.newContent));
    }

    stderr.write(`${conflictSummary(report.updates.length)}\n`);
  };
}
