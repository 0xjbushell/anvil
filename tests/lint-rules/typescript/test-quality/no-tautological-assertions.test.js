'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/test-quality/no-tautological-assertions.js');

ruleTester.run('no-tautological-assertions', rule, {
  valid: [
    {
      code: 'expect(result).toBe(42);',
      filename: 'src/compute.test.ts',
    },
    {
      code: 'expect(isValid(input)).toBe(true);',
      filename: 'src/validate.test.ts',
    },
    {
      code: 'expect(add(1, 2)).toEqual(3);',
      filename: 'src/add.spec.js',
    },
    {
      code: 'expect(1).toBe(2);',
      filename: 'src/math.test.ts',
    },
    {
      code: 'expect(1).not.toBe(1); expect("hello").not.toEqual("hello"); expect(false).not.toBeFalsy();',
      filename: 'src/negated.test.ts',
    },
    {
      code: 'expect(true).toBe(true);',
      filename: 'src/source.ts',
    },
  ],
  invalid: [
    {
      code: 'expect(true).toBe(true);',
      filename: 'src/tautology.test.ts',
      errors: [{ messageId: 'tautologicalAssertion' }],
    },
    {
      code: 'expect(42).toEqual(42);',
      filename: 'src/number.spec.ts',
      errors: [{ messageId: 'tautologicalAssertion' }],
    },
    {
      code: 'expect("hello").toStrictEqual("hello");',
      filename: 'src/string.test.ts',
      errors: [{ messageId: 'tautologicalAssertion' }],
    },
    {
      code: 'expect(true).toBeTruthy();',
      filename: 'src/truthy.test.ts',
      errors: [{ messageId: 'tautologicalAssertion' }],
    },
    {
      code: 'expect(false).toBeFalsy();',
      filename: 'src/falsy.test.ts',
      errors: [{ messageId: 'tautologicalAssertion' }],
    },
  ],
});
