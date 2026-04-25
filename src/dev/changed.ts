export interface ChangedScenario {
  name: string;
  input: string;
  inputLanguage?: string;
}

const fixtureInputPrefix = "tests/fixtures/inputs/";

const languageAliasGroups = [
  ["typescript", "ts"],
  ["go", "golang"],
  ["python", "py"],
] as const;

const aliasToGroup = new Map<string, readonly string[]>();
for (const group of languageAliasGroups) {
  for (const alias of group) {
    aliasToGroup.set(alias, group);
  }
}

export function normalizeChangedFilePath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function isAtOrUnder(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(`${directory}/`);
}

function scenarioTokens(scenario: ChangedScenario): Set<string> {
  return new Set(
    `${scenario.name} ${scenario.input} ${scenario.inputLanguage ?? ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

function matchesLanguageAliases(scenario: ChangedScenario, aliases: readonly string[]): boolean {
  const tokens = scenarioTokens(scenario);
  return aliases.some((alias) => tokens.has(alias));
}

function templateAliasesForPath(filePath: string): readonly string[] | "all" | undefined {
  if (!isAtOrUnder(filePath, "templates")) return undefined;

  const [, languageSegment] = filePath.split("/");
  if (languageSegment === undefined) return "all";

  return aliasToGroup.get(languageSegment.toLowerCase()) ?? "all";
}

export function selectRelevantScenarios<T extends ChangedScenario>(
  scenarios: readonly T[],
  changedFiles: readonly string[],
): T[] {
  const normalizedChangedFiles = changedFiles.map(normalizeChangedFilePath).filter((filePath) => filePath.length > 0);
  if (normalizedChangedFiles.length === 0 || scenarios.length === 0) return [];

  if (normalizedChangedFiles.some((filePath) => isAtOrUnder(filePath, "src"))) {
    return [...scenarios];
  }

  const templateAliasGroups: (readonly string[])[] = [];
  for (const filePath of normalizedChangedFiles) {
    const templateAliases = templateAliasesForPath(filePath);
    if (templateAliases === "all") {
      return [...scenarios];
    }
    if (templateAliases !== undefined) {
      templateAliasGroups.push(templateAliases);
    }
  }

  return scenarios.filter((scenario) => {
    const inputDirectory = `${fixtureInputPrefix}${scenario.input}`;
    if (normalizedChangedFiles.some((filePath) => isAtOrUnder(filePath, inputDirectory))) {
      return true;
    }

    return templateAliasGroups.some((aliases) => matchesLanguageAliases(scenario, aliases));
  });
}
