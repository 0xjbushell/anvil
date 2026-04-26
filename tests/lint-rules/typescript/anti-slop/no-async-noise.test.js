'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/no-async-noise.js');

ruleTester.run('no-async-noise', rule, {
  valid: [
    'async function getData() { const data = await fetch(url); return data; }',
    'async function getData() { try { return await fetch(url); } catch (err) { throw err; } }',
    'const getData = async () => { await init(); return result; };',
    'async function readAll(stream) { for await (const chunk of stream) { process(chunk); } }',
    'function getData() { return fetch(url); }',
  ],
  invalid: [
    {
      code: 'async function getData() { return await fetch(url); }',
      errors: [{ messageId: 'redundantReturnAwait' }],
    },
    {
      code: 'async function getData() { return fetch(url); }',
      errors: [{ messageId: 'asyncWithoutAwait' }],
    },
    {
      code: 'const getData = async () => { return Promise.resolve(42); };',
      errors: [{ messageId: 'asyncWithoutAwait' }],
    },
    {
      code: 'async function validate(input) { return input.length > 0; }',
      errors: [{ messageId: 'asyncWithoutAwait' }],
    },
    {
      code: 'async function outer() { async function inner() { await fetch(url); } return inner; }',
      errors: [{ messageId: 'asyncWithoutAwait' }],
    },
  ],
});
