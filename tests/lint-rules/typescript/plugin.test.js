import { describe, expect, test } from 'bun:test';

async function loadPlugin() {
  const { default: plugin } = await import(
    '../../../static/typescript/tools/lint-rules/plugin.js'
  );

  return plugin;
}

describe('anvil ESLint plugin', () => {
  test('loads without error', async () => {
    const plugin = await loadPlugin();

    expect(plugin).toBeDefined();
  });

  test('exports CommonJS plugin as the ESM default export', async () => {
    const plugin = await loadPlugin();

    expect(plugin).toBeDefined();
    expect(plugin.rules).toEqual({});
    expect(plugin.configs).toBeDefined();
    expect(typeof plugin.configs).toBe('object');
  });

  test('exports a recommended flat config', async () => {
    const plugin = await loadPlugin();

    expect(plugin.configs.recommended).toBeDefined();
    expect(plugin.configs.recommended.rules).toEqual({});
  });

  test('recommended config references the default-exported plugin', async () => {
    const plugin = await loadPlugin();

    expect(plugin.configs.recommended.plugins).toBeDefined();
    expect(plugin.configs.recommended.plugins.anvil).toBe(plugin);
  });
});
