import { describe, expect, test } from 'bun:test';

async function importPlugin() {
  return import('../../../static/typescript/tools/lint-rules/plugin.js');
}

describe('anvil ESLint plugin', () => {
  test('loads without error', async () => {
    const { default: plugin } = await importPlugin();

    expect(plugin).toBeDefined();
  });

  test('exports CommonJS plugin as the ESM default export', async () => {
    const pluginModule = await importPlugin();
    const plugin = pluginModule.default;

    expect(plugin).toBeDefined();
    expect(plugin.rules).toEqual({});
    expect(plugin.configs).toBeDefined();
    expect(typeof plugin.configs).toBe('object');
  });

  test('exports a recommended flat config', async () => {
    const { default: plugin } = await importPlugin();

    expect(plugin.configs.recommended).toBeDefined();
    expect(plugin.configs.recommended.rules).toEqual({});
  });

  test('recommended config references the default-exported plugin', async () => {
    const { default: plugin } = await importPlugin();

    expect(plugin.configs.recommended.plugins).toBeDefined();
    expect(plugin.configs.recommended.plugins.anvil).toBe(plugin);
  });
});
