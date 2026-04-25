import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { diffLines, type Change } from "diff";

import type { ConflictAction, ConflictHandler } from "../types.ts";

type PromptAction = ConflictAction | "diff";

const conflictChoices: ReadonlyArray<{ name: string; value: PromptAction }> = [
  { name: "Overwrite", value: "overwrite" },
  { name: "Skip", value: "skip" },
  { name: "Show diff", value: "diff" },
  { name: "Abort", value: "abort" },
];

function splitPreservingLineEndings(value: string): string[] {
  return value.match(/[^\n]*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function formatDiffPart(part: Change): string {
  const prefix = part.added ? "+" : part.removed ? "-" : " ";
  const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.dim;

  return splitPreservingLineEndings(part.value)
    .map((line) => color(`${prefix}${line}`))
    .join("");
}

function renderDiff(filePath: string, existingContent: string, newContent: string): string {
  const body = diffLines(existingContent, newContent)
    .map((part) => formatDiffPart(part))
    .join("");
  const output = `--- existing ${filePath}\n+++ new ${filePath}\n${body}`;

  return output.endsWith("\n") ? output : `${output}\n`;
}

async function promptForAction(filePath: string): Promise<PromptAction> {
  return select<PromptAction>({
    message: `File already exists: ${filePath}`,
    choices: conflictChoices,
  });
}

export function createInteractiveConflictHandler(): ConflictHandler {
  return async (filePath, existingContent, newContent) => {
    while (true) {
      const action = await promptForAction(filePath);

      if (action === "diff") {
        process.stderr.write(renderDiff(filePath, existingContent, newContent));
        continue;
      }

      return { path: filePath, action };
    }
  };
}
