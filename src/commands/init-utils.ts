import type { TextWriter } from "../scaffold/conflict-reporter.ts";

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function writeLine(writer: TextWriter, line = ""): void {
  writer.write(`${line}\n`);
}

export function commandText(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}
