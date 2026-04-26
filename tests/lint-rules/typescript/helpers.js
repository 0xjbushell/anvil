'use strict';

const { RuleTester } = require('eslint');
const parser = require('@typescript-eslint/parser');

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

module.exports = { ruleTester };
