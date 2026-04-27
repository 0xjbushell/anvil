'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/no-exported-function-expressions.js');

ruleTester.run('no-exported-function-expressions', rule, {
  valid: [
    'export function getData() { return []; }',
    'export const MAX_RETRIES = 3;',
    'const helper = () => 1;',
    'export const makeHandler = factory(() => 1);',
    'export default () => 1;',
  ],
  invalid: [
    {
      code: 'export const getData = () => { return []; };',
      errors: [{ messageId: 'exportedFunctionExpression' }],
    },
    {
      code: 'export const getData = function() { return []; };',
      errors: [{ messageId: 'exportedFunctionExpression' }],
    },
    {
      code: 'export let build = async () => 1;',
      errors: [{ messageId: 'exportedFunctionExpression' }],
    },
    {
      code: 'const helper = () => 1; export { helper };',
      errors: [{ messageId: 'exportedFunctionExpression' }],
    },
    {
      code: 'export var parse = function parse(input: string) { return input.trim(); };',
      errors: [{ messageId: 'exportedFunctionExpression' }],
    },
  ],
});
