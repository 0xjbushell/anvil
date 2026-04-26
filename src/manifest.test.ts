import { describe, expect, test } from "bun:test";

import { getManifest, type Lang, type ManifestEntry, type ScaffoldContext } from "./manifest.ts";

const languages: Lang[] = ["typescript", "golang", "python"];
const validSources = new Set(["static", "template", "generator"]);
const expectedRanges: Record<Lang, { min: number; max: number }> = {
  typescript: { min: 23, max: 30 },
  golang: { min: 18, max: 26 },
  python: { min: 18, max: 24 },
};
const expectedSeedDests: Record<Lang, string[]> = {
  typescript: [
    "src/seed/constants.ts",
    "src/seed/enums.ts",
    "src/seed/errors.ts",
    "src/seed/seed.test.ts",
    "src/seed/seed.ts",
    "src/seed/types.ts",
  ],
  golang: [
    "cmd/app/main.go",
    "internal/seed/constants.go",
    "internal/seed/enums.go",
    "internal/seed/errors.go",
    "internal/seed/seed.go",
    "internal/seed/seed_test.go",
    "internal/seed/types.go",
  ],
  python: [
    "src/seed/__init__.py",
    "src/seed/constants.py",
    "src/seed/enums.py",
    "src/seed/errors.py",
    "src/seed/seed.py",
    "src/seed/types.py",
    "tests/conftest.py",
    "tests/test_seed.py",
  ],
};

function makeContext(
  lang: Lang,
  overrides: Partial<ScaffoldContext> = {},
): ScaffoldContext {
  return {
    projectName: "example",
    lang,
    targetDir: "/tmp/example",
    hasExistingCode: false,
    skipSeed: false,
    packageManager: lang === "typescript" ? "bun" : undefined,
    defaultBranch: "main",
    nonInteractive: true,
    toolchain: { bun: "1.1.34" },
    anvilVersion: "0.1.0",
    ...overrides,
  };
}

function seedEntries(lang: Lang): ManifestEntry[] {
  const { entries } = getManifest(lang);

  if (lang === "golang") {
    return entries.filter(
      (entry) => entry.dest.startsWith("internal/seed/") || entry.dest === "cmd/app/main.go",
    );
  }

  if (lang === "python") {
    return entries.filter(
      (entry) =>
        entry.dest.startsWith("src/seed/") ||
        entry.dest === "tests/conftest.py" ||
        entry.dest === "tests/test_seed.py",
    );
  }

  return entries.filter((entry) => entry.dest.startsWith("src/seed/"));
}

describe("scaffold manifests", () => {
  test("each supported language returns a non-empty manifest", () => {
    for (const lang of languages) {
      const manifest = getManifest(lang);

      expect(manifest.lang).toBe(lang);
      expect(manifest.entries.length).toBeGreaterThan(0);
    }
  });

  test("entry counts stay in the expected output-map ranges", () => {
    for (const lang of languages) {
      const { entries } = getManifest(lang);
      const range = expectedRanges[lang];

      expect(entries.length).toBeGreaterThanOrEqual(range.min);
      expect(entries.length).toBeLessThanOrEqual(range.max);
    }
  });

  test("every entry has required fields and a valid source", () => {
    for (const lang of languages) {
      for (const entry of getManifest(lang).entries) {
        expect(entry.dest).toBeTruthy();
        expect(entry.src).toBeTruthy();
        expect(validSources.has(entry.source)).toBe(true);
      }
    }
  });

  test("static and template sources point under their expected roots", () => {
    for (const lang of languages) {
      for (const entry of getManifest(lang).entries) {
        if (entry.source === "static") {
          expect(entry.src.startsWith(`static/${lang}/`)).toBe(true);
        }

        if (entry.source === "template") {
          expect(
            entry.src.startsWith("src/templates/") || entry.src.startsWith(`static/${lang}/`),
          ).toBe(true);
          expect(entry.src.endsWith(".ejs")).toBe(true);
        }
      }
    }
  });

  test("generator entries use stable generator ids", () => {
    const generatorEntries = languages.flatMap((lang) =>
      getManifest(lang).entries.filter((entry) => entry.source === "generator"),
    );

    expect(generatorEntries.length).toBeGreaterThan(0);
    for (const entry of generatorEntries) {
      expect(entry.src).toMatch(/^[a-z]+\/[a-z0-9-]+$/);
    }
  });

  test("seed conditions account for existing code and explicit seed skips", () => {
    for (const lang of languages) {
      for (const entry of seedEntries(lang)) {
        expect(entry.when).toBeDefined();
        expect(entry.when?.(makeContext(lang, { hasExistingCode: true, skipSeed: true }))).toBe(
          false,
        );
        expect(entry.when?.(makeContext(lang, { hasExistingCode: false, skipSeed: true }))).toBe(
          false,
        );
        expect(entry.when?.(makeContext(lang, { hasExistingCode: true, skipSeed: false }))).toBe(
          false,
        );
        expect(entry.when?.(makeContext(lang, { hasExistingCode: false, skipSeed: false }))).toBe(
          true,
        );
      }
    }
  });

  test("non-seed entries are unconditional", () => {
    for (const lang of languages) {
      const seeds = new Set(seedEntries(lang).map((entry) => entry.dest));
      const nonSeedEntries = getManifest(lang).entries.filter((entry) => !seeds.has(entry.dest));

      expect(nonSeedEntries.length).toBeGreaterThan(0);
      for (const entry of nonSeedEntries) {
        expect(entry.when).toBeUndefined();
      }
    }
  });

  test("seed paths are correct for each language", () => {
    for (const lang of languages) {
      const seedDests = seedEntries(lang).map((entry) => entry.dest).sort();

      expect(seedDests).toEqual(expectedSeedDests[lang]);
    }
  });

  test("directory tree entries use explicit glob-like paths for downstream expansion", () => {
    const expectedGlobDests: Record<Lang, string[]> = {
      typescript: [
        "tools/lint-rules/anti-slop/**/*",
        "tools/lint-rules/error-handling/**/*",
        "tools/lint-rules/structural/**/*",
        "tools/lint-rules/test-quality/**/*",
      ],
      golang: [
        "tools/go-analyzers/anti_slop/**/*",
        "tools/go-analyzers/cmd/anvil-lint/**/*",
        "tools/go-analyzers/structural/**/*",
        "tools/go-analyzers/test_quality/**/*",
        "tools/go-analyzers/testdata/**/*",
      ],
      python: ["tools/flake8-plugin/anvil_lint/**/*"],
    };

    for (const lang of languages) {
      const dests = new Set(getManifest(lang).entries.map((entry) => entry.dest));

      for (const dest of expectedGlobDests[lang]) {
        expect(dests.has(dest)).toBe(true);
      }
    }
  });

  test("TypeScript manifest includes lint-rule CommonJS package boundary", () => {
    const dests = getManifest("typescript").entries.map((entry) => entry.dest);

    expect(dests).toContain("tools/lint-rules/package.json");
  });

  test("Go analyzer manifest defers CRAP report until its scaffold exists", () => {
    const dests = getManifest("golang").entries.map((entry) => entry.dest);

    expect(dests).not.toContain("tools/go-analyzers/cmd/crap-report/**/*");
  });

  test("invalid languages throw", () => {
    const unsupportedLang = "rust" as unknown as Lang;

    expect(() => getManifest(unsupportedLang)).toThrow("Unsupported language");
  });

  test("destinations are unique within each language", () => {
    for (const lang of languages) {
      const dests = getManifest(lang).entries.map((entry) => entry.dest);

      expect(new Set(dests).size).toBe(dests.length);
    }
  });

  test("no manifest entry references the lockfile", () => {
    for (const lang of languages) {
      for (const entry of getManifest(lang).entries) {
        expect(entry.dest).not.toContain(".anvil.lock");
        expect(entry.src).not.toContain(".anvil.lock");
      }
    }
  });

  test("template and static root skeletons exist", async () => {
    const paths = [
      new URL("./templates/.gitkeep", import.meta.url),
      new URL("../static/typescript/.gitkeep", import.meta.url),
      new URL("../static/golang/.gitkeep", import.meta.url),
      new URL("../static/python/.gitkeep", import.meta.url),
    ];

    for (const path of paths) {
      expect(await Bun.file(path).exists()).toBe(true);
    }
  });
});
