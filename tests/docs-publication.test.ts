import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function readJson<T>(rel: string): T {
  return JSON.parse(read(rel)) as T;
}

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type WorkflowStep = {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  needs?: string;
  steps?: WorkflowStep[];
  permissions?: Record<string, string>;
};

type Workflow = {
  on?: {
    pull_request?: unknown;
    push?: { branches?: string[] };
    workflow_dispatch?: unknown;
  };
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
};

function skillMarkdown(): string {
  return read("docs/public/skills/anvil/SKILL.md");
}

function skillFrontmatter(): SkillFrontmatter {
  const match = skillMarkdown().match(/^---\n(?<frontmatter>[\s\S]*?)\n---/);

  expect(match?.groups?.frontmatter).toBeDefined();
  return parseYaml(match?.groups?.frontmatter ?? "") as SkillFrontmatter;
}

describe("TIX-000091 docs publication shell", () => {
  test("wires isolated Astro Starlight docs package through root scripts", () => {
    const rootPkg = readJson<PackageJson>("package.json");
    const docsPkg = readJson<PackageJson>("docs/package.json");

    expect(rootPkg.scripts?.["docs:build"]).toBe("cd docs && bun run build");
    expect(rootPkg.scripts?.["docs:check"]).toBe("cd docs && bun run check");
    expect(docsPkg.scripts?.build).toBe("astro build");
    expect(docsPkg.scripts?.check).toBe("astro check && astro build");
    expect(docsPkg.dependencies?.astro).toBeDefined();
    expect(docsPkg.dependencies?.["@astrojs/starlight"]).toBeDefined();
    expect(docsPkg.devDependencies?.["@astrojs/check"]).toBeDefined();
  });

  test("configures Starlight for the GitHub Pages repo path", () => {
    const astroConfig = read("docs/astro.config.mjs");

    expect(astroConfig).toContain("@astrojs/starlight");
    expect(astroConfig).toContain("site: \"https://0xjbushell.github.io\"");
    expect(astroConfig).toContain("base: \"/anvil\"");
    expect(astroConfig).toContain("title: \"Anvil\"");
    expect(existsSync(path.join(repoRoot, "docs/src/content/docs/index.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "docs/src/content.config.ts"))).toBe(true);
  });

  test("builds and deploys docs with standard GitHub Pages actions", () => {
    const workflow = parseYaml(read(".github/workflows/docs.yml")) as Workflow;

    expect(workflow.on?.pull_request).toBeDefined();
    expect(workflow.on?.push?.branches).toContain("main");
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.permissions).toEqual({ contents: "read" });

    const build = workflow.jobs?.build;
    const deploy = workflow.jobs?.deploy;
    const buildSteps = build?.steps ?? [];
    const deploySteps = deploy?.steps ?? [];

    expect(build?.permissions).toEqual({ contents: "read" });
    expect(buildSteps.some((step) => step.uses === "actions/checkout@v4")).toBe(true);
    expect(buildSteps.some((step) => step.uses === "oven-sh/setup-bun@v2")).toBe(true);
    expect(buildSteps.some((step) => step.uses === "actions/configure-pages@v5")).toBe(true);
    expect(buildSteps.some((step) => step.run === "cd docs && bun install --frozen-lockfile")).toBe(true);
    expect(buildSteps.some((step) => step.run === "bun docs:check")).toBe(true);
    expect(
      buildSteps.some(
        (step) =>
          step.uses === "actions/upload-pages-artifact@v3" && step.with?.path === "docs/dist",
      ),
    ).toBe(true);

    expect(deploy?.needs).toBe("build");
    expect(deploy?.permissions).toMatchObject({ pages: "write", "id-token": "write" });
    expect(deploySteps.some((step) => step.uses === "actions/deploy-pages@v4")).toBe(true);
  });
});

describe("TIX-000092 README and docs navigation", () => {
  const docsUrl = "https://0xjbushell.github.io/anvil/";
  const requiredDocs = [
    "getting-started",
    "installation",
    "cli-reference",
    "how-anvil-works",
    "existing-projects",
    "using-with-coding-agents",
    "troubleshooting",
    "languages/typescript",
    "languages/golang",
    "languages/python",
    "examples/greenfield-typescript",
    "examples/greenfield-golang",
    "examples/greenfield-python",
    "examples/existing-project",
  ];

  test("keeps README as a concise public landing page with public next links", () => {
    const readme = read("README.md");
    const firstScreen = readme.split(/\r?\n/).slice(0, 36).join("\n");

    expect(firstScreen).toContain("agent-ready project scaffolder");
    expect(firstScreen).toContain("TypeScript/JavaScript, Go, and Python");
    expect(firstScreen).toContain("bunx anvil init --lang typescript");
    expect(firstScreen).toContain(`[Full documentation](${docsUrl})`);
    expect(firstScreen).toContain("[Releases](https://github.com/0xjbushell/anvil/releases)");
    expect(firstScreen).toContain("[CHANGELOG.md](CHANGELOG.md)");
    expect(firstScreen).toContain("[Contributing](#contributing)");
    expect(firstScreen).not.toContain("DOC-");
    expect(firstScreen).not.toContain("TIX-");
    expect(firstScreen).not.toContain("D-");
    expect(firstScreen).not.toContain("specs/");
    expect(readme.length).toBeLessThan(6_000);
  });

  test("exposes required human docs sections in Starlight navigation", () => {
    const astroConfig = read("docs/astro.config.mjs");

    for (const slug of requiredDocs) {
      expect(astroConfig).toContain(`slug: "${slug}"`);
      expect(existsSync(path.join(repoRoot, `docs/src/content/docs/${slug}.md`))).toBe(true);
    }

    expect(astroConfig).toContain("sidebar:");
    expect(astroConfig).toContain("social: [{ icon: \"github\"");
    expect(astroConfig).toContain("label: \"Start here\"");
    expect(astroConfig).toContain("label: \"Reference\"");
    expect(astroConfig).toContain("label: \"Languages\"");
    expect(astroConfig).toContain("label: \"Examples\"");
    expect(astroConfig).not.toContain("specs/");
  });

  test("uses the configured GitHub Pages URL instead of an unconfigured custom domain", () => {
    const publicSurfaces = [
      read("README.md"),
      read("docs/astro.config.mjs"),
      read("docs/src/content/docs/index.md"),
    ].join("\n");

    expect(publicSurfaces).toContain(docsUrl);
    expect(publicSurfaces).not.toContain("https://anvil.sh");
  });

  test("keeps baseline docs links valid for the configured base path", () => {
    expect(read("docs/src/content/docs/getting-started.md")).toContain(
      "[Existing Projects](/anvil/existing-projects/)",
    );
  });
});

describe("TIX-000093 agent bootstrap prompt", () => {
  const startUrl = "https://0xjbushell.github.io/anvil/start.md";
  const prompt = `Fetch ${startUrl} and follow it to install Anvil, adopt it safely in this repository, and run the validation loop.`;

  test("publishes concise /start.md with bootstrap-only safety rules", () => {
    const start = read("docs/public/start.md");
    const lines = start.trim().split(/\r?\n/);

    expect(lines.length).toBeLessThanOrEqual(80);
    expect(start).toContain("# Anvil bootstrap prompt");
    expect(start).toContain("Preserve unrelated work");
    expect(start).toContain("git status --short");
    expect(start).toContain("Inspect before installing or writing");
    expect(start).toContain("command -v anvil");
    expect(start).toContain("bunx anvil");
    expect(start).toContain("raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh");
    expect(start).toContain("<anvil-cmd> --version");
    expect(start).toContain("Ask whether to install the Anvil agent skill");
    expect(start).toContain("https://0xjbushell.github.io/anvil/skills/anvil/SKILL.md");
    expect(existsSync(path.join(repoRoot, "docs/public/skills/anvil/SKILL.md"))).toBe(true);
    expect(start).toContain("install it and follow that skill");
    expect(start).toContain("If the user declines or the harness cannot install skills");
    expect(start).toContain("<anvil-cmd> init --lang <typescript|golang|python> --dry-run");
    expect(start).toContain("Do not blindly overwrite conflicts");
    expect(start).toContain("Report:");
    expect(start).not.toContain("https://anvil.sh");
    expect(start).not.toContain("## Troubleshooting");
    expect(start).not.toContain("language guide");
  });

  test("keeps Anvil selection order explicit and safe", () => {
    const start = read("docs/public/start.md");
    const existing = start.indexOf("If `command -v anvil` succeeds");
    const bunx = start.indexOf("Otherwise, if Bun is available");
    const standalone = start.indexOf("Otherwise, install the standalone binary");
    const dryRun = start.indexOf("<anvil-cmd> init --lang <typescript|golang|python> --dry-run");

    expect(existing).toBeGreaterThanOrEqual(0);
    expect(bunx).toBeGreaterThan(existing);
    expect(standalone).toBeGreaterThan(bunx);
    expect(dryRun).toBeGreaterThan(standalone);
  });

  test("exposes the exact homepage copy prompt for coding agents", () => {
    const index = read("docs/src/content/docs/index.md");

    expect(index).toContain("## Agent-assisted adoption");
    expect(index).toContain(prompt);
    expect(index).toContain(startUrl);
  });
});

describe("TIX-000095 human docs content", () => {
  test("documents installer behavior for latest and pinned standalone releases", () => {
    const install = read("docs/src/content/docs/installation.md");

    expect(install).toContain("scripts/install.sh");
    expect(install).toContain("https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh");
    expect(install).toContain("install.sh | bash");
    expect(install).toContain("bash -c \"$(curl -fsSL https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh)\"");
    expect(install).not.toContain("install.sh | sh");
    expect(install).toContain("https://github.com/0xjbushell/anvil/releases/latest/download/anvil-<os>-<arch>");
    expect(install).toContain("https://github.com/0xjbushell/anvil/releases/download/<version>/anvil-<os>-<arch>");
    expect(install).toContain("ANVIL_VERSION=v0.2.0");
    expect(install).toContain("ANVIL_INSTALL_DIR");
    expect(install).toContain("linux");
    expect(install).toContain("darwin");
    expect(install).toContain("windows");
    expect(install).toContain("x64");
    expect(install).toContain("arm64");
    expect(install).not.toContain("https://anvil.sh");
  });

  test("keeps CLI reference aligned with Commander surface", () => {
    const cliReference = read("docs/src/content/docs/cli-reference.md");

    expect(cliReference).toContain("current working directory");
    expect(cliReference).toContain("There is no `--target-dir` flag");
    expect(cliReference).toContain("`anvil init --lang <typescript|golang|python>`");
    expect(cliReference).toContain("`--dry-run`");
    expect(cliReference).toContain("`--non-interactive`");
    expect(cliReference).toContain("explicit opt-in");
    expect(cliReference).toContain("`anvil doctor`");
    expect(cliReference).toContain("`anvil --version`");
    expect(cliReference).toContain("`anvil -V`");
    expect(cliReference).toContain("| `anvil init` | `0` |");
    expect(cliReference).toContain("| `anvil init` | `1` |");
    expect(cliReference).toContain("| `anvil doctor` | `0` |");
    expect(cliReference).toContain("| `anvil doctor` | `1` |");
    expect(cliReference).not.toContain("`anvil update`");
  });

  test("keeps human coding-agent docs explanatory instead of protocol-owning", () => {
    const agentDocs = read("docs/src/content/docs/using-with-coding-agents.md");

    expect(agentDocs).toContain("[bootstrap prompt](/anvil/start.md)");
    expect(agentDocs).toContain("[Anvil skill](/anvil/skills/anvil/SKILL.md)");
    expect(agentDocs).toContain("Human docs explain the model");
    expect(agentDocs).not.toContain("command -v anvil");
    expect(agentDocs).not.toContain("git status --short");
    expect(agentDocs).not.toContain("Minimal fallback adoption");
  });

  test("provides practical examples with supported language flags and Make targets", () => {
    const examples = [
      read("docs/src/content/docs/examples/greenfield-typescript.md"),
      read("docs/src/content/docs/examples/greenfield-golang.md"),
      read("docs/src/content/docs/examples/greenfield-python.md"),
      read("docs/src/content/docs/examples/existing-project.md"),
    ].join("\n");

    for (const flag of ["--lang typescript", "--lang golang", "--lang python"]) {
      expect(examples).toContain(flag);
    }
    for (const target of ["make check", "make quality"]) {
      expect(examples).toContain(target);
    }
    expect(examples).toContain("--dry-run");
    expect(examples).not.toContain("anvil update");
    expect(examples).not.toContain("generate CI");
  });
});

describe("TIX-000094 installable Anvil skill", () => {
  test("publishes Markdown skill metadata with lifecycle trigger coverage", () => {
    const skill = skillMarkdown();
    const frontmatter = skillFrontmatter();
    const description = frontmatter.description?.toLowerCase() ?? "";

    expect(frontmatter.name).toBe("anvil");
    for (const trigger of ["install", "adopt", "update", "re-scaffold", "validate", "troubleshoot", "explain generated tooling"]) {
      expect(description).toContain(trigger);
    }
    expect(skill.trim().split(/\r?\n/).length).toBeLessThan(220);
    expect(description).not.toContain("<");
    expect(description).not.toContain(">");
  });

  test("owns the canonical Anvil lifecycle workflows and safety rules", () => {
    const skill = skillMarkdown();

    for (const section of [
      "## Safety rules",
      "## Install or select Anvil",
      "## Create a new Anvil project",
      "## Adopt an existing repository",
      "## Re-scaffold after an Anvil upgrade",
      "## Validate generated project",
      "## Troubleshoot common failures",
      "## Report",
    ]) {
      expect(skill).toContain(section);
    }

    for (const required of [
      "Preserve unrelated work",
      "git status --short",
      "Ask the user before choosing a language",
      "Ask before writing over files",
      "Never resolve generated-file conflicts by guessing",
      "Do not invent secrets, versions, release assets, or unsupported commands",
      "https://raw.githubusercontent.com/0xjbushell/anvil/main/scripts/install.sh",
      "install.sh | bash",
      "<anvil-cmd> --version",
      "<anvil-cmd> init --lang <typescript|golang|python> --dry-run",
      "<anvil-cmd> init --lang <typescript|golang|python>",
      "<anvil-cmd> doctor",
      "generated README",
      "make check",
      "make quality",
      ".anvil.lock",
      "Do not hand-edit `.anvil.lock`",
    ]) {
      expect(skill).toContain(required);
    }

    expect(skill).not.toContain("`anvil update`");
    expect(skill).not.toContain("install.sh | sh");
    expect(skill).not.toMatch(/\boverwrite conflicts blindly\b/i);
  });

  test("keeps bootstrap prompt and skill lifecycle instructions non-overlapping", () => {
    const start = read("docs/public/start.md");
    const skill = skillMarkdown();

    expect(start).toContain("## Minimal fallback adoption");
    expect(skill).toContain("Do not re-fetch or expand `/start.md` for lifecycle work");
    for (const lifecycleOnly of [
      "## Create a new Anvil project",
      "## Re-scaffold after an Anvil upgrade",
      "## Troubleshoot common failures",
      "<anvil-cmd> doctor",
      "make quality",
    ]) {
      expect(skill).toContain(lifecycleOnly);
      expect(start).not.toContain(lifecycleOnly);
    }
  });

  test("documents portable Markdown skill installation and fallback without duplicating protocol", () => {
    const agentDocs = read("docs/src/content/docs/using-with-coding-agents.md");

    expect(agentDocs).toContain("portable Markdown skill");
    expect(agentDocs).toContain("https://0xjbushell.github.io/anvil/skills/anvil/SKILL.md");
    expect(agentDocs).toContain("If your harness cannot install skills");
    expect(agentDocs).toContain("follow the hosted Markdown instructions as the reusable protocol");
    expect(agentDocs).toContain("The page is not the lifecycle protocol");
    expect(agentDocs).not.toContain("command -v anvil");
    expect(agentDocs).not.toContain("anvil init --lang");
    expect(agentDocs).not.toContain("anvil doctor");
  });
});
