import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(import.meta.dir, '..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('TIX-000069 AGENTS.md', () => {
  test('documents agent onboarding guardrails', () => {
    const txt = read('AGENTS.md');
    const lines = txt.trimEnd().split(/\r?\n/);

    expect(lines.length).toBeLessThanOrEqual(40);
    for (const heading of [
      '## Project shape',
      '## Inner loop',
      '## Reference implementations',
      '## Decision discipline',
      '## Where things live',
    ]) {
      expect(txt).toContain(heading);
    }

    expect(txt).toContain('Bun + TypeScript scaffolder for agentic engineering projects');
    expect(txt).toContain('After every change, run `bun agent:check`');
    expect(txt).toContain('`bun dev <scenario>`');
    expect(txt).toContain('cd into `.sandbox/scratch`');
    expect(txt).toContain('read the failed scenario YAML and input');
    expect(txt).toContain('reproduce in the sandbox');
    expect(txt).toContain('fix the cause');
    expect(txt).toContain('rerun');
    expect(txt).toContain('pre-push hook and CI run the full `bun fixtures` and `bun mutation` gates');
    expect(txt).toContain('[D-69]');
    expect(txt).toContain('match reference idioms unless an anvil decision explicitly overrides them');
    expect(txt).toContain('specs/decisions/anvil-decisions.md');
    expect(txt).toContain('cite D-NN');
    for (const path of ['`src/`', '`src/templates/`', '`tests/fixtures/`', '`specs/`', '`.tix/`']) {
      expect(txt).toContain(path);
    }
  });
});

describe('TIX-000070 governance', () => {
  test('1. LICENSE exists and is MIT', () => {
    const txt = read('LICENSE');
    expect(/mit license/i.test(txt)).toBe(true);
    expect(txt).toContain('Permission is hereby granted, free of charge');
  });

  test('2. release-please configs are valid JSON', () => {
    expect(() => JSON.parse(read('release-please-config.json'))).not.toThrow();
    expect(() => JSON.parse(read('.release-please-manifest.json'))).not.toThrow();
    const cfg = JSON.parse(read('release-please-config.json'));
    expect(cfg['release-type']).toBe('node');
  });

  test('3. release-please workflow YAML is valid', () => {
    const wf = parseYaml(read('.github/workflows/release.yml'));
    const uses = wf?.jobs?.release?.steps?.[0]?.uses;
    expect(typeof uses).toBe('string');
    expect(uses).toContain('googleapis/release-please-action');
  });

  test('4. commitlint config loads', async () => {
    const mod = await import('../commitlint.config.mjs');
    expect(Array.isArray(mod.default.extends)).toBe(true);
    expect(mod.default.extends).toContain('@commitlint/config-conventional');
  });

  test('5. husky hook present, references commitlint, and is executable', () => {
    const path = join(repoRoot, '.husky/commit-msg');
    const txt = readFileSync(path, 'utf8');
    expect(txt).toContain('commitlint --edit "$1"');
    const mode = statSync(path).mode;
    expect(mode & 0o111).toBeTruthy();
  });

  test('6. package.json wiring', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts?.prepare).toBeUndefined();
    const dd = pkg.devDependencies ?? {};
    expect(dd['@commitlint/cli']).toBeDefined();
    expect(dd['@commitlint/config-conventional']).toBeDefined();
    expect(dd['husky']).toBeDefined();
  });

  const commitlintInstalled = existsSync(join(repoRoot, 'node_modules/@commitlint/cli'));
  test.skipIf(!commitlintInstalled)(
    '7. commitlint hook integration: bad rejected, good accepted',
    () => {
      const dir = join(repoRoot, '.sandbox/governance-commitlint');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const badFile = join(dir, 'bad.txt');
      const goodFile = join(dir, 'good.txt');
      try {
        writeFileSync(badFile, 'add feature\n');
        writeFileSync(goodFile, 'feat: add feature\n');

        const bad = spawnSync('bunx', ['--bun', 'commitlint', '--edit', badFile], {
          cwd: repoRoot,
          encoding: 'utf8',
        });
        expect(bad.status).not.toBe(0);

        const good = spawnSync('bunx', ['--bun', 'commitlint', '--edit', goodFile], {
          cwd: repoRoot,
          encoding: 'utf8',
        });
        expect(good.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test('8. pre-push hook runs fixtures and mutation and is executable', () => {
    const path = join(repoRoot, '.husky/pre-push');
    const txt = readFileSync(path, 'utf8');
    expect(txt.startsWith('#!/usr/bin/env sh')).toBe(true);
    expect(txt.split(/\r?\n/).some((line) => line.trim() === 'set -e')).toBe(true);
    expect(txt.split(/\r?\n/).some((line) => line.trim() === 'bun fixtures')).toBe(true);
    expect(txt.split(/\r?\n/).some((line) => line.trim() === 'bun mutation')).toBe(true);
    const mode = statSync(path).mode;
    expect(mode & 0o111).toBeTruthy();
  });

  test('9. hook installer configures Husky hooks and is executable', () => {
    const path = join(repoRoot, 'scripts/install-hooks.sh');
    const txt = readFileSync(path, 'utf8');
    expect(txt.startsWith('#!/usr/bin/env sh')).toBe(true);
    expect(txt).toContain('git config core.hooksPath .husky');
    expect(txt).toContain('.husky');
    const mode = statSync(path).mode;
    expect(mode & 0o111).toBeTruthy();
  });

  test('10. fixtures workflow YAML is valid and runs fixtures plus mutation', () => {
    const wf = parseYaml(read('.github/workflows/fixtures.yml'));
    expect(wf?.on?.pull_request).toBeDefined();
    expect(wf?.on?.push?.branches).toContain('main');

    const steps = wf?.jobs?.fixtures?.steps ?? [];
    expect(steps.some((step: { uses?: string }) => step.uses === 'actions/checkout@v4')).toBe(true);
    expect(steps.some((step: { uses?: string }) => step.uses === 'oven-sh/setup-bun@v2')).toBe(true);
    const runSteps = steps.flatMap((step: { run?: string }) =>
      typeof step.run === 'string' ? [step.run] : [],
    );
    const installIndex = runSteps.findIndex((run: string) => run.includes('bun install --frozen-lockfile'));
    const fixturesIndex = runSteps.findIndex((run: string) => run.trim() === 'bun fixtures');
    const mutationIndex = runSteps.findIndex((run: string) => run.trim() === 'bun mutation');
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(fixturesIndex).toBeGreaterThan(installIndex);
    expect(mutationIndex).toBeGreaterThan(fixturesIndex);
  });

  test('11. README §Contributing documents local and CI fixture checks', () => {
    const txt = read('README.md');
    expect(txt).toContain('## Contributing');
    expect(txt).toContain('Conventional Commits');
    expect(txt).toContain('release-please');
    expect(txt).toContain('Run `scripts/install-hooks.sh`');
    expect(txt).toContain('scripts/install-hooks.sh');
    expect(txt).toContain('pre-push');
    expect(txt).toContain('bun fixtures');
    expect(txt).toContain('bun mutation');
    expect(txt).toContain('git push --no-verify');
    expect(txt).toContain('pull requests and pushes to `main`');
  });

  test('12. package exposes mutation as a first-class quality gate', () => {
    const pkg = JSON.parse(read('package.json'));

    expect(pkg.scripts?.mutation).toBe('stryker run');
    expect(pkg.scripts?.quality).toBe('bun mutation');
    expect(pkg.devDependencies?.['@stryker-mutator/core']).toBe('9.6.1');
  });
});
