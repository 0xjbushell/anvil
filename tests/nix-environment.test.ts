import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const repoRoot = join(import.meta.dir, '..');
const shell = '/bin/sh';

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

describe('TIX-000077 Nix-backed validation environments', () => {
  test('flake exposes default and release shells with the required release toolchain', () => {
    expect(existsSync(join(repoRoot, 'flake.nix'))).toBe(true);
    expect(existsSync(join(repoRoot, 'flake.lock'))).toBe(true);

    const flake = read('flake.nix');
    expect(flake).toContain('default = pkgs.mkShell');
    expect(flake).toContain('release = pkgs.mkShell');

    for (const requiredPackage of [
      'bun',
      'nodejs_22',
      'python311',
      'gcc',
      'gnumake',
      'go',
      'uv',
      'gitleaks',
      'govulncheck',
      'golangci-lint',
      'go-tools',
      'deadcode',
    ]) {
      expect(flake).toContain(requiredPackage);
    }
  });

  test('package scripts expose local validation wrappers', () => {
    const pkg = JSON.parse(read('package.json'));

    expect(pkg.scripts?.['nix:env:check']).toBe(
      'scripts/nix-run.sh release -- scripts/require-tools.sh release',
    );
    expect(pkg.scripts?.['nix:agent:check']).toBe(
      'scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun agent:check',
    );
    expect(pkg.scripts?.['nix:fixtures']).toBe(
      'scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun fixtures',
    );
    expect(pkg.scripts?.['nix:test']).toBe(
      'scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun test',
    );
    expect(pkg.scripts?.['nix:build']).toBe(
      'scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun run build',
    );
    expect(pkg.scripts?.['nix:mutation']).toBe(
      'scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun mutation',
    );
  });

  test('fixtures CI uses the same Nix wrappers as local contributors', () => {
    const workflow = parseYaml(read('.github/workflows/fixtures.yml'));
    const steps = workflow?.jobs?.fixtures?.steps ?? [];

    expect(steps.some((step: { uses?: string }) => step.uses === 'cachix/install-nix-action@v31')).toBe(true);

    const runSteps = steps.flatMap((step: { run?: string }) =>
      typeof step.run === 'string' ? [step.run] : [],
    );
    expect(runSteps).toContain('scripts/nix-run.sh release -- bun install --frozen-lockfile');
    expect(runSteps).toContain('scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun fixtures');
    expect(runSteps).toContain('scripts/nix-run.sh release -- scripts/require-tools.sh release -- bun mutation');
    expect(runSteps).not.toContain('bun fixtures');
    expect(runSteps).not.toContain('bun mutation');
  });

  test('nix wrapper fails clearly before validation when Nix is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anvil-no-nix-'));

    try {
      const result = spawnSync('/usr/bin/env', [
        '-i',
        `PATH=${dir}`,
        'ANVIL_NIX_BIN=definitely-missing-nix',
        shell,
        'scripts/nix-run.sh',
        'release',
        '--',
        'true',
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(127);
      expect(result.stderr).toContain('Nix is required to run Anvil validation wrappers');
      expect(result.stderr).toContain('D-72');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nix wrapper validates the requested flake output before invoking Nix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anvil-nix-wrapper-'));
    const log = join(dir, 'nix.log');
    writeExecutable(
      join(dir, 'nix'),
      `#!/bin/sh
printf '%s\\n' "$*" > "${log}"
`,
    );

    try {
      const result = spawnSync(shell, ['scripts/nix-run.sh', 'missing', '--', 'true'], {
        cwd: repoRoot,
        env: { PATH: dir },
        encoding: 'utf8',
      });

      expect(result.status).toBe(64);
      expect(result.stderr).toContain('unknown Nix environment "missing"');
      expect(existsSync(log)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('nix wrapper invokes the selected flake shell with flakes enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anvil-nix-wrapper-'));
    const log = join(dir, 'nix.log');
    writeExecutable(
      join(dir, 'nix'),
      `#!/bin/sh
printf '%s\\n' "$*" > "${log}"
`,
    );

    try {
      const result = spawnSync(shell, ['scripts/nix-run.sh', 'release', '--', 'echo', 'ok'], {
        cwd: repoRoot,
        env: { PATH: dir },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toBe(
        '--extra-experimental-features nix-command flakes develop .#release --command echo ok\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tool preflight reports missing required tools and does not run validation', () => {
    const result = spawnSync(shell, ['scripts/require-tools.sh', 'release', '--', shell, '-c', 'echo should-not-run'], {
      cwd: repoRoot,
      env: { PATH: '' },
      encoding: 'utf8',
    });

    expect(result.status).toBe(127);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Anvil release validation environment is missing required tools');
    expect(result.stderr).toContain('bun');
    expect(result.stderr).toContain('govulncheck');
    expect(result.stderr).toContain('deadcode');
    expect(result.stderr).not.toContain('should-not-run');
  });

  test('tool preflight execs validation only after all release tools resolve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anvil-nix-tools-'));
    const marker = join(dir, 'ran');

    for (const tool of [
      'bun',
      'node',
      'node-gyp',
      'python3',
      'gcc',
      'g++',
      'make',
      'git',
      'go',
      'uv',
      'gitleaks',
      'govulncheck',
      'golangci-lint',
      'staticcheck',
      'deadcode',
    ]) {
      writeExecutable(join(dir, tool), '#!/bin/sh\nexit 0\n');
    }

    try {
      const result = spawnSync(shell, [
        'scripts/require-tools.sh',
        'release',
        '--',
        shell,
        '-c',
        `printf ran > "${marker}"`,
      ], {
        cwd: repoRoot,
        env: { PATH: dir },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(readFileSync(marker, 'utf8')).toBe('ran');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
