import type { Lang, LanguageManifest, ManifestEntry, ScaffoldContext } from "./types.ts";

export type { FileSource, Lang, LanguageManifest, ManifestEntry, ScaffoldContext } from "./types.ts";

const includeSeed = (ctx: ScaffoldContext): boolean => !ctx.hasExistingCode && !ctx.skipSeed;

function staticEntry(lang: Lang, dest: string, when?: ManifestEntry["when"]): ManifestEntry {
  return {
    dest,
    src: `static/${lang}/${dest}`,
    source: "static",
    ...(when ? { when } : {}),
  };
}

function templateEntry(lang: Lang, dest: string): ManifestEntry {
  return {
    dest,
    src: `src/templates/${lang}/${dest}.ejs`,
    source: "template",
  };
}

function generatorEntry(dest: string, src: string): ManifestEntry {
  return {
    dest,
    src,
    source: "generator",
  };
}

const typescriptEntries: ManifestEntry[] = [
  staticEntry("typescript", "src/seed/seed.ts", includeSeed),
  staticEntry("typescript", "src/seed/seed.test.ts", includeSeed),
  staticEntry("typescript", "src/seed/types.ts", includeSeed),
  staticEntry("typescript", "src/seed/errors.ts", includeSeed),
  staticEntry("typescript", "src/seed/constants.ts", includeSeed),
  staticEntry("typescript", "src/seed/enums.ts", includeSeed),
  staticEntry("typescript", "tools/lint-rules/plugin.js"),
  staticEntry("typescript", "tools/lint-rules/anti-slop/**/*"),
  staticEntry("typescript", "tools/lint-rules/structural/**/*"),
  staticEntry("typescript", "tools/lint-rules/test-quality/**/*"),
  staticEntry("typescript", "tools/crap-score.ts"),
  templateEntry("typescript", "eslint.config.mjs"),
  templateEntry("typescript", "tsconfig.json"),
  templateEntry("typescript", ".prettierrc"),
  generatorEntry("package.json", "typescript/package-json"),
  templateEntry("typescript", "vitest.config.ts"),
  staticEntry("typescript", "knip.json"),
  staticEntry("typescript", "stryker.config.mjs"),
  templateEntry("typescript", "Makefile"),
  templateEntry("typescript", ".pre-commit-config.yaml"),
  templateEntry("typescript", ".gitignore"),
  staticEntry("typescript", ".gitattributes"),
  staticEntry("typescript", ".editorconfig"),
  staticEntry("typescript", ".gitleaks.toml"),
  templateEntry("typescript", "AGENTS.md"),
  templateEntry("typescript", "README.md"),
];

const golangEntries: ManifestEntry[] = [
  staticEntry("golang", "internal/seed/seed.go", includeSeed),
  staticEntry("golang", "internal/seed/seed_test.go", includeSeed),
  staticEntry("golang", "internal/seed/types.go", includeSeed),
  staticEntry("golang", "internal/seed/errors.go", includeSeed),
  staticEntry("golang", "internal/seed/constants.go", includeSeed),
  staticEntry("golang", "internal/seed/enums.go", includeSeed),
  staticEntry("golang", "cmd/app/main.go", includeSeed),
  staticEntry("golang", "tools/tools.go"),
  staticEntry("golang", "tools/go-analyzers/cmd/anvil-lint/**/*"),
  staticEntry("golang", "tools/go-analyzers/cmd/crap-report/**/*"),
  staticEntry("golang", "tools/go-analyzers/anti_slop/**/*"),
  staticEntry("golang", "tools/go-analyzers/structural/**/*"),
  staticEntry("golang", "tools/go-analyzers/test_quality/**/*"),
  staticEntry("golang", "tools/go-analyzers/go.mod"),
  staticEntry("golang", "tools/go-analyzers/Makefile"),
  templateEntry("golang", "go.mod"),
  templateEntry("golang", ".golangci.yml"),
  templateEntry("golang", "Makefile"),
  templateEntry("golang", ".pre-commit-config.yaml"),
  templateEntry("golang", ".gitignore"),
  staticEntry("golang", ".gitattributes"),
  staticEntry("golang", ".editorconfig"),
  staticEntry("golang", ".gitleaks.toml"),
  templateEntry("golang", "AGENTS.md"),
  templateEntry("golang", "README.md"),
];

const pythonEntries: ManifestEntry[] = [
  staticEntry("python", "src/seed/__init__.py", includeSeed),
  staticEntry("python", "src/seed/seed.py", includeSeed),
  staticEntry("python", "src/seed/types.py", includeSeed),
  staticEntry("python", "src/seed/errors.py", includeSeed),
  staticEntry("python", "src/seed/constants.py", includeSeed),
  staticEntry("python", "src/seed/enums.py", includeSeed),
  staticEntry("python", "tests/conftest.py", includeSeed),
  staticEntry("python", "tests/test_seed.py", includeSeed),
  staticEntry("python", "tools/flake8-plugin/anvil_lint/**/*"),
  staticEntry("python", "tools/flake8-plugin/setup.py"),
  staticEntry("python", "tools/flake8-plugin/setup.cfg"),
  templateEntry("python", "pyproject.toml"),
  templateEntry("python", ".flake8"),
  templateEntry("python", "Makefile"),
  templateEntry("python", ".pre-commit-config.yaml"),
  templateEntry("python", ".gitignore"),
  staticEntry("python", ".gitattributes"),
  staticEntry("python", ".editorconfig"),
  staticEntry("python", ".gitleaks.toml"),
  templateEntry("python", "AGENTS.md"),
  templateEntry("python", "README.md"),
];

const manifests: Record<Lang, LanguageManifest> = {
  typescript: { lang: "typescript", entries: typescriptEntries },
  golang: { lang: "golang", entries: golangEntries },
  python: { lang: "python", entries: pythonEntries },
};

export function getManifest(lang: Lang): LanguageManifest {
  const manifest = manifests[lang];

  if (!manifest) {
    throw new Error(`Unsupported language: ${String(lang)}`);
  }

  return {
    lang: manifest.lang,
    entries: [...manifest.entries],
  };
}
