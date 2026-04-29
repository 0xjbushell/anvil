import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getManifest } from '../src/manifest.ts';

const repoRoot = join(import.meta.dir, '..');
const pluginRoot = 'static/python/tools/flake8-plugin';
const scaffoldFiles = [
  'anvil_lint/__init__.py',
  'anvil_lint/anti_slop.py',
  'anvil_lint/error_handling.py',
  'anvil_lint/structural.py',
  'anvil_lint/test_quality.py',
  'setup.py',
  'setup.cfg',
  'tests/conftest.py',
  'tests/test_plugin.py',
  'tests/test_structural.py',
] as const;
const stubModules = [
  ['error_handling.py', 'check_error_handling', 'TIX-000048'],
  ['test_quality.py', 'check_test_quality', 'TIX-000047'],
] as const;

function readPluginFile(path: string): string {
  return readFileSync(join(repoRoot, pluginRoot, path), 'utf8');
}

function listGeneratedPythonArtifacts(directory: string, relativeDirectory = ''): string[] {
  const artifacts: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') {
        artifacts.push(relativePath);
      }

      artifacts.push(...listGeneratedPythonArtifacts(fullPath, relativePath));
    } else if (/\.py[cod]$/.test(entry.name)) {
      artifacts.push(relativePath);
    }
  }

  return artifacts;
}

describe('TIX-000044 Python Flake8 plugin scaffold', () => {
  test('all scaffold files exist in the static Python plugin tree', () => {
    for (const path of scaffoldFiles) {
      expect(existsSync(join(repoRoot, pluginRoot, path))).toBe(true);
    }
  });

  test('static plugin tree does not include generated Python bytecode artifacts', () => {
    expect(listGeneratedPythonArtifacts(join(repoRoot, pluginRoot))).toEqual([]);
  });

  test('Python manifest includes plugin package, setup, and test scaffold entries', () => {
    const destinations = getManifest('python').entries.map((entry) => entry.dest);

    expect(destinations).toContain('tools/flake8-plugin/anvil_lint/**/*');
    expect(destinations).toContain('tools/flake8-plugin/tests/**/*');
    expect(destinations).toContain('tools/flake8-plugin/setup.py');
    expect(destinations).toContain('tools/flake8-plugin/setup.cfg');
  });

  test('AnvilChecker exposes the Flake8 checker protocol and delegates to rule modules', () => {
    const plugin = readPluginFile('anvil_lint/__init__.py');

    expect(plugin).toContain('class AnvilChecker:');
    expect(plugin).toContain('name = "anvil-lint"');
    expect(plugin).toContain('version = "0.1.0"');
    expect(plugin).toContain('def add_options(cls, option_manager):');
    expect(plugin).toContain('"--anvil-source-dir"');
    expect(plugin).toContain('"--max-file-length"');
    expect(plugin).toContain('"--max-function-length"');
    expect(plugin).toContain('def parse_options(cls, options) -> None:');
    expect(plugin).toContain('def __init__(self, tree: ast.AST, filename: str) -> None:');
    expect(plugin).toContain('def run(self) -> Generator[tuple[int, int, str, type], None, None]:');
    expect(plugin).toContain('yield from check_anti_slop(self.tree, self.filename, self._source_dirs)');
    expect(plugin).toContain('yield from check_error_handling(self.tree, self.filename)');
    expect(plugin).toContain('yield from check_structural(');
    expect(plugin).toContain('max_file_length=self._max_file_length');
    expect(plugin).toContain('max_function_length=self._max_function_length');
    expect(plugin).toContain('yield from check_test_quality(self.tree, self.filename)');
  });

  test('structural checker scaffold exposes ANV101-ANV108 contract and options', () => {
    const structural = readPluginFile('anvil_lint/structural.py');
    const tests = readPluginFile('tests/test_structural.py');

    for (const code of ['ANV101', 'ANV102', 'ANV103', 'ANV104', 'ANV105', 'ANV106', 'ANV107', 'ANV108']) {
      expect(structural).toContain(code);
      expect(tests).toContain(code);
    }

    expect(structural).toContain('max_file_length');
    expect(structural).toContain('max_function_length');
    expect(structural).not.toContain('ANV109');
    expect(structural).not.toContain('ANV110');
  });

  test('remaining stub modules expose documented empty generator functions', () => {
    for (const [path, functionName, ticket] of stubModules) {
      const source = readPluginFile(`anvil_lint/${path}`);

      expect(source).toContain(`def ${functionName}(`);
      expect(source).toContain('tree: ast.AST');
      expect(source).toContain('filename: str');
      expect(source).toContain('Generator[tuple[int, int, str, type], None, None]');
      expect(source).toContain(ticket);
      expect(source).toContain('yield from ()');
    }
  });

  test('packaging registers the ANV Flake8 extension with Python 3.11 and Flake8 6+', () => {
    const setupPy = readPluginFile('setup.py');
    const setupCfg = readPluginFile('setup.cfg');

    expect(setupPy).toContain('name="anvil-lint"');
    expect(setupPy).toContain('version="0.1.0"');
    expect(setupPy).toContain('"ANV = anvil_lint:AnvilChecker"');
    expect(setupPy).toContain('"flake8>=6.0"');
    expect(setupPy).toContain('python_requires=">=3.11"');

    expect(setupCfg).toContain('[options.entry_points]');
    expect(setupCfg).toContain('flake8.extension =');
    expect(setupCfg).toContain('ANV = anvil_lint:AnvilChecker');
    expect(setupCfg).toContain('flake8>=6.0');
    expect(setupCfg).toContain('python_requires = >=3.11');
  });

  test('Python test helpers cover full checker and standalone check functions', () => {
    const conftest = readPluginFile('tests/conftest.py');

    expect(conftest).toContain('def run_checker(');
    expect(conftest).toContain('checker = checker_class(tree, filename)');
    expect(conftest).toContain('checker.run()');
    expect(conftest).toContain('def run_check_function(');
    expect(conftest).toContain('check_fn(tree, filename)');
    expect(conftest).toContain('return [(line, col, msg) for line, col, msg, _ in');
  });
});
