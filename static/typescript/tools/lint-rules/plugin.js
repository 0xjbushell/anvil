'use strict';

const noLogAndContinue = require('./anti-slop/no-log-and-continue.js');
const noErrorObscuring = require('./anti-slop/no-error-obscuring.js');
const noPlaceholderComments = require('./anti-slop/no-placeholder-comments.js');
const noLogAndThrow = require('./anti-slop/no-log-and-throw.js');
const noSilentErrorSwallow = require('./error-handling/no-silent-error-swallow.js');

const rules = {
  'no-log-and-continue': noLogAndContinue,
  'no-error-obscuring': noErrorObscuring,
  'no-placeholder-comments': noPlaceholderComments,
  'no-log-and-throw': noLogAndThrow,
  'no-silent-error-swallow': noSilentErrorSwallow,
};

const plugin = {
  rules,
  configs: {},
};

plugin.configs.recommended = {
  plugins: { anvil: plugin },
  rules: {
    'anvil/no-log-and-continue': 'error',
    'anvil/no-error-obscuring': 'error',
    'anvil/no-placeholder-comments': 'error',
    'anvil/no-log-and-throw': 'error',
    'anvil/no-silent-error-swallow': 'error',
  },
};

module.exports = plugin;
