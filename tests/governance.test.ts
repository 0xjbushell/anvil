import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(import.meta.dir, '..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

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
    expect(pkg.scripts?.prepare).toBe('husky');
    const dd = pkg.devDependencies ?? {};
    expect(dd['@commitlint/cli']).toBeDefined();
    expect(dd['@commitlint/config-conventional']).toBeDefined();
    expect(dd['husky']).toBeDefined();
  });

  const commitlintInstalled = existsSync(join(repoRoot, 'node_modules/@commitlint/cli'));
  test.skipIf(!commitlintInstalled)('7. commitlint hook integration: bad rejected, good accepted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anvil-commitlint-'));
    const badFile = join(dir, 'bad.txt');
    const goodFile = join(dir, 'good.txt');
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
  });

  test('8. README §Contributing exists', () => {
    const txt = read('README.md');
    expect(txt).toContain('## Contributing');
    expect(txt).toContain('Conventional Commits');
    expect(txt).toContain('release-please');
  });
});
