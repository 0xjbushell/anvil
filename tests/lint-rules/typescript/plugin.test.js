import { describe, expect, test } from 'bun:test';

async function loadPlugin() {
  const { default: plugin } = await import(
    '../../../static/typescript/tools/lint-rules/plugin.js'
  );

  return plugin;
}

describe('anvil ESLint plugin', () => {
  const expectedRuleNames = [
    'no-log-and-continue',
    'no-error-obscuring',
    'no-placeholder-comments',
    'no-log-and-throw',
    'no-pass-through-wrapper',
    'require-structured-logging',
    'require-test-files',
    'no-async-noise',
    'no-silent-error-swallow',
  ];

  test('loads without error', async () => {
    const plugin = await loadPlugin();

    expect(plugin).toBeDefined();
  });

  test('exports CommonJS plugin as the ESM default export', async () => {
    const plugin = await loadPlugin();

    expect(plugin).toBeDefined();
    expect(Object.keys(plugin.rules)).toEqual(expectedRuleNames);
    for (const ruleName of expectedRuleNames) {
      expect(plugin.rules[ruleName]).toBeDefined();
      expect(plugin.rules[ruleName].meta).toBeDefined();
      expect(typeof plugin.rules[ruleName].create).toBe('function');
    }
    expect(plugin.configs).toBeDefined();
    expect(typeof plugin.configs).toBe('object');
  });

  test('exports a recommended flat config', async () => {
    const plugin = await loadPlugin();

    expect(plugin.configs.recommended).toBeDefined();
    expect(plugin.configs.recommended.rules).toEqual(
      Object.fromEntries(expectedRuleNames.map((ruleName) => [`anvil/${ruleName}`, 'error'])),
    );
  });

  test('recommended config references the default-exported plugin', async () => {
    const plugin = await loadPlugin();

    expect(plugin.configs.recommended.plugins).toBeDefined();
    expect(plugin.configs.recommended.plugins.anvil).toBe(plugin);
  });
});
