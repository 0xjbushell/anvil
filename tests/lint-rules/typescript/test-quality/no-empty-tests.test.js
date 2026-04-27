'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/test-quality/no-empty-tests.js');

ruleTester.run('no-empty-tests', rule, {
  valid: [
    {
      code: "it('validates input', () => { expect(validate('abc')).toBe(true); });",
      filename: 'src/validate.test.ts',
    },
    {
      code: "test.only('returns data', () => { const result = getData(); assert.equal(result.id, 1); });",
      filename: 'src/data.spec.js',
    },
    {
      code: "test.each([[1]])('returns %s', (value) => { expect(value).toBe(1); });",
      filename: 'src/parameterized.test.ts',
    },
    {
      code: "describe('container', () => { setupSuite(); });",
      filename: 'src/container.test.ts',
    },
    {
      code: "it('ignores non-test source files', () => {});",
      filename: 'src/source.ts',
    },
  ],
  invalid: [
    {
      code: "it('validates input', () => {});",
      filename: 'src/validate.test.ts',
      errors: [{ messageId: 'emptyTest', data: { testName: 'validates input' } }],
    },
    {
      code: "test('processes data', () => { const data = getData(); processData(data); });",
      filename: 'src/process.spec.js',
      errors: [{ messageId: 'emptyTest', data: { testName: 'processes data' } }],
    },
    {
      code: "it.only('returns result', function () { const result = compute(); const expected = 42; });",
      filename: 'src/compute.test.ts',
      errors: [{ messageId: 'emptyTest', data: { testName: 'returns result' } }],
    },
    {
      code: "test.each([[1]])('parameterized %s', (value) => { const doubled = value * 2; });",
      filename: 'src/parameterized.test.ts',
      errors: [{ messageId: 'emptyTest', data: { testName: 'parameterized %s' } }],
    },
  ],
});
