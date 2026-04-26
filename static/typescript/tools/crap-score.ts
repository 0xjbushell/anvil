import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

interface Position {
  line: number;
  column: number;
}

interface Location {
  start: Position;
  end: Position;
}

interface FunctionCoverage {
  name: string;
  decl: Location;
  loc: Location;
}

interface BranchCoverage {
  loc: Location;
  locations?: Location[];
}

interface FileCoverage {
  path?: string;
  fnMap: Record<string, FunctionCoverage>;
  f: Record<string, number>;
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  branchMap: Record<string, BranchCoverage>;
  b: Record<string, number[]>;
}

export interface FunctionReport {
  file: string;
  functionName: string;
  complexity: number;
  coverage: number;
  crapScore: number;
}

interface RunOptions {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface CliOptions {
  coverageDir: string;
  thresholdWarn: number;
  thresholdError: number;
}

const DEFAULT_OPTIONS: CliOptions = {
  coverageDir: "coverage",
  thresholdWarn: 30,
  thresholdError: 45,
};

export function calculateCrapScore(complexity: number, coverage: number): number {
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\r\n]*/g, "")
    .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, "");
}

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

export function countCyclomaticComplexity(source: string): number {
  const stripped = stripCommentsAndStrings(source);
  const branchKeywords = countMatches(stripped, /\b(?:if|for|switch|case|catch)\b/g);
  const doLoops = countMatches(stripped, /\bdo\b/g);
  const whileKeywords = countMatches(stripped, /\bwhile\b/g);
  const logicalOperators = countMatches(stripped, /&&|\|\|/g);
  const ternaries = countTernaryOperators(stripped);

  return 1 + branchKeywords + doLoops + whileKeywords + logicalOperators + ternaries;
}

function getNextNonWhitespaceIndex(source: string, startIndex: number): number {
  for (let index = startIndex; index < source.length; index += 1) {
    if (!/\s/.test(source[index])) {
      return index;
    }
  }

  return -1;
}

function countTernaryOperators(source: string): number {
  let count = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "?") {
      continue;
    }

    const previous = source[index - 1];
    const next = source[index + 1];
    const nextMeaningfulIndex = getNextNonWhitespaceIndex(source, index + 1);
    if (
      previous === "?" ||
      next === "." ||
      next === "?" ||
      nextMeaningfulIndex === -1 ||
      source[nextMeaningfulIndex] === ":"
    ) {
      continue;
    }

    let depth = 0;
    for (let scanIndex = index + 1; scanIndex < source.length; scanIndex += 1) {
      const char = source[scanIndex];
      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
        continue;
      }

      if (char === ")" || char === "]" || char === "}") {
        if (depth === 0) {
          break;
        }
        depth -= 1;
        continue;
      }

      if (depth === 0 && char === ";") {
        break;
      }

      if (depth === 0 && char === ":") {
        count += 1;
        break;
      }
    }
  }

  return count;
}

function containsLocation(outer: Location, inner: Location): boolean {
  return inner.start.line >= outer.start.line && inner.end.line <= outer.end.line;
}

function sliceLocation(source: string, loc: Location): string {
  return source
    .split(/\r?\n/)
    .slice(loc.start.line - 1, loc.end.line)
    .join("\n");
}

function resolveCoveragePath(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function calculateCoverage(fileCoverage: FileCoverage, functionId: string): number {
  const functionLoc = fileCoverage.fnMap[functionId].loc;
  let covered = 0;
  let total = 0;

  for (const [statementId, statementLoc] of Object.entries(fileCoverage.statementMap)) {
    if (containsLocation(functionLoc, statementLoc)) {
      total += 1;
      covered += fileCoverage.s[statementId] > 0 ? 1 : 0;
    }
  }

  for (const [branchId, branch] of Object.entries(fileCoverage.branchMap)) {
    if (!containsLocation(functionLoc, branch.loc)) {
      continue;
    }

    const hits = fileCoverage.b[branchId] || [];
    total += hits.length;
    covered += hits.filter((hitCount) => hitCount > 0).length;
  }

  if (total === 0) {
    return fileCoverage.f[functionId] > 0 ? 1 : 0;
  }

  return covered / total;
}

export function computeFunctionReports(
  coverageReport: Record<string, FileCoverage>,
  cwd = process.cwd(),
): FunctionReport[] {
  const reports: FunctionReport[] = [];

  for (const [coveragePath, fileCoverage] of Object.entries(coverageReport)) {
    const filePath = resolveCoveragePath(cwd, fileCoverage.path || coveragePath);
    const source = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

    for (const [functionId, functionCoverage] of Object.entries(fileCoverage.fnMap)) {
      const functionSource = sliceLocation(source, functionCoverage.loc);
      const complexity = countCyclomaticComplexity(functionSource);
      const coverage = calculateCoverage(fileCoverage, functionId);

      reports.push({
        file: filePath,
        functionName: functionCoverage.name || `<anonymous:${functionId}>`,
        complexity,
        coverage,
        crapScore: calculateCrapScore(complexity, coverage),
      });
    }
  }

  return reports.sort((left, right) => right.crapScore - left.crapScore);
}

function parseNumberFlag(value: string | undefined, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flagName} must be a number.`);
  }

  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--coverage-dir") {
      options.coverageDir = args[index + 1] || options.coverageDir;
      index += 1;
      continue;
    }

    if (arg === "--threshold-warn") {
      options.thresholdWarn = parseNumberFlag(args[index + 1], arg);
      index += 1;
      continue;
    }

    if (arg === "--threshold-error") {
      options.thresholdError = parseNumberFlag(args[index + 1], arg);
      index += 1;
    }
  }

  return options;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function statusForScore(score: number, options: CliOptions): string {
  if (score > options.thresholdError) {
    return "ERROR";
  }

  if (score > options.thresholdWarn) {
    return "WARN";
  }

  return "OK";
}

function formatReport(report: FunctionReport, cwd: string, options: CliOptions): string {
  const file = relative(cwd, report.file) || report.file;
  return [
    file,
    report.functionName,
    String(report.complexity),
    formatPercent(report.coverage),
    report.crapScore.toFixed(2),
    statusForScore(report.crapScore, options),
  ].join(" | ");
}

export function runCrapScore(args = process.argv.slice(2), runOptions: RunOptions = {}): number {
  const cwd = runOptions.cwd || process.cwd();
  const stdout = runOptions.stdout || console.log;
  const stderr = runOptions.stderr || console.error;
  const options = parseArgs(args);
  const coverageFile = join(cwd, options.coverageDir, "coverage-final.json");

  if (!existsSync(coverageFile)) {
    stderr(`Coverage file not found: ${coverageFile}`);
    return 1;
  }

  const coverageReport = JSON.parse(readFileSync(coverageFile, "utf8")) as Record<string, FileCoverage>;
  const reports = computeFunctionReports(coverageReport, cwd);

  stdout("File | Function | Complexity | Coverage | CRAP | Status");
  for (const report of reports) {
    stdout(formatReport(report, cwd, options));
  }

  return reports.some((report) => report.crapScore > options.thresholdError) ? 1 : 0;
}

if (import.meta.main) {
  process.exit(runCrapScore());
}
