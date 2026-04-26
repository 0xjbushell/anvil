'use strict';

const rules = {};

const plugin = {
  rules,
  configs: {},
};

plugin.configs.recommended = {
  plugins: { anvil: plugin },
  rules: {},
};

module.exports = plugin;
