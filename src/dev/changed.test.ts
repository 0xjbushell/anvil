import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

import { selectRelevantScenarios, normalizeChangedFilePath } from "./changed.ts";
import { ScenarioSchema } from "./schema.ts";

const scenarios = [
  { name: "typescript-greenfield", input: "ts-app", yamlPath: "typescript.yaml" },
  { name: "go-greenfield", input: "golang-app", yamlPath: "go.yaml" },
  { name: "python-greenfield", input: "py-app", yamlPath: "python.yaml" },
  { name: "unit-tests", input: "generic-app", yamlPath: "generic.yaml" },
];

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const fixtureInputRoot = path.join(repoRoot, "tests", "fixtures", "inputs");
const fixtureScenarioRoot = path.join(repoRoot, "tests", "fixtures", "scenarios");

interface CatalogScenario {
  name: string;
  input: string;
  inputLanguage?: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function readInputLanguage(input: string): Promise<string | undefined> {
  try {
    const lockfile = await readFile(path.join(fixtureInputRoot, input, ".anvil.lock"), "utf8");
    const parsed = parseYaml(lockfile) as { lang?: unknown } | null;
    return typeof parsed?.lang === "string" ? parsed.lang : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function loadCommittedScenarioCatalog(): Promise<CatalogScenario[]> {
  const scenarioFiles = (await readdir(fixtureScenarioRoot)).filter((name) => name.endsWith(".yaml")).sort();
  const catalog: CatalogScenario[] = [];

  for (const scenarioFile of scenarioFiles) {
    const scenario = ScenarioSchema.parse(parseYaml(await readFile(path.join(fixtureScenarioRoot, scenarioFile), "utf8")));
    catalog.push({
      name: scenario.name,
      input: scenario.input,
      inputLanguage: await readInputLanguage(scenario.input),
    });
  }

  return catalog;
}

function selectedNames(changedFiles: string[]): string[] {
  return selectRelevantScenarios(scenarios, changedFiles).map((scenario) => scenario.name);
}

describe("changed-file fixture selection", () => {
  test("normalizes git paths to POSIX-style relative paths", () => {
    expect(normalizeChangedFilePath(String.raw`.\tests\fixtures\inputs\ts-app\src\index.ts`)).toBe(
      "tests/fixtures/inputs/ts-app/src/index.ts",
    );
  });

  test("input fixture changes select only scenarios using that input", () => {
    expect(selectedNames(["tests/fixtures/inputs/golang-app/main.go"])).toEqual(["go-greenfield"]);
  });

  test("language template changes select matching language scenarios and skip others", () => {
    expect(selectedNames(["templates/typescript/Makefile.ejs"])).toEqual(["typescript-greenfield"]);
    expect(selectedNames(["templates/ts/package.json.ejs"])).toEqual(["typescript-greenfield"]);
    expect(selectedNames(["templates/go/Makefile.ejs"])).toEqual(["go-greenfield"]);
    expect(selectedNames(["templates/golang/package.json.ejs"])).toEqual(["go-greenfield"]);
    expect(selectedNames(["templates/python/Makefile.ejs"])).toEqual(["python-greenfield"]);
    expect(selectedNames(["templates/py/package.json.ejs"])).toEqual(["python-greenfield"]);
  });

  test("language template changes can match fixture input language metadata aliases", () => {
    const metadataOnlyScenarios = [
      { name: "clean", input: "clean", inputLanguage: "typescript" },
      { name: "service", input: "service", inputLanguage: "golang" },
      { name: "script", input: "script", inputLanguage: "python" },
      { name: "generic", input: "generic" },
    ];

    expect(
      selectRelevantScenarios(metadataOnlyScenarios, ["templates/ts/package.json.ejs"]).map((scenario) => scenario.name),
    ).toEqual(["clean"]);
    expect(selectRelevantScenarios(metadataOnlyScenarios, ["templates/go/Makefile.ejs"]).map((scenario) => scenario.name))
      .toEqual(["service"]);
    expect(selectRelevantScenarios(metadataOnlyScenarios, ["templates/py/Makefile.ejs"]).map((scenario) => scenario.name))
      .toEqual(["script"]);
  });

  test("typescript template changes select current TypeScript fixture scenarios from metadata and scenario names", async () => {
    const catalog = await loadCommittedScenarioCatalog();
    const expectedTypescriptScenarios = catalog
      .filter((scenario) => scenario.inputLanguage === "typescript")
      .map((scenario) => scenario.name)
      .sort();

    expect(expectedTypescriptScenarios).toEqual([
      "re-scaffold-clean",
      "re-scaffold-drift",
      "re-scaffold-template-bumped",
    ]);
    expect(
      selectRelevantScenarios(catalog, ["templates/typescript/Makefile.ejs"])
        .map((scenario) => scenario.name)
        .sort(),
    ).toEqual(["greenfield-ts-interactive", ...expectedTypescriptScenarios]);
  });

  test("shared template changes select every scenario", () => {
    expect(selectedNames(["templates/_shared/Makefile.ejs"])).toEqual(scenarios.map((scenario) => scenario.name));
    expect(selectedNames(["templates/base.ejs"])).toEqual(scenarios.map((scenario) => scenario.name));
  });

  test("source changes select every scenario", () => {
    expect(selectedNames(["src/scaffold/render.ts"])).toEqual(scenarios.map((scenario) => scenario.name));
  });

  test("unrelated docs changes select no scenarios", () => {
    expect(selectedNames(["docs/foo.md"])).toEqual([]);
  });
});
