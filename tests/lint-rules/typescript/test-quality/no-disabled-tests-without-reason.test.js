'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/test-quality/no-disabled-tests-without-reason.js');

ruleTester.run('no-disabled-tests-without-reason', rule, {
  valid: [
    {
      code: "// Skipped: flaky due to CI timing\nit.skip('handles concurrent requests', () => {});",
      filename: 'src/concurrency.test.ts',
    },
    {
      code: "test.skip('broken after API change', () => {}); // TODO(PROJ-123): restore after migration",
      filename: 'src/api.spec.js',
    },
    {
      code: "// Disabled until auth service fixture exists\nxtest('authenticates users', () => {});",
      filename: 'src/auth.test.ts',
    },
    {
      code: "it.skip('not in a test file', () => {});",
      filename: 'src/source.ts',
    },
  ],
  invalid: [
    {
      code: "it.skip('validates input', () => {});",
      filename: 'src/validate.test.ts',
      errors: [{ messageId: 'disabledTestWithoutReason' }],
    },
    {
      code: "test.skip('processes data', () => {});",
      filename: 'src/process.spec.js',
      errors: [{ messageId: 'disabledTestWithoutReason' }],
    },
    {
      code: "xtest('returns results', () => {});",
      filename: 'src/results.test.ts',
      errors: [{ messageId: 'disabledTestWithoutReason' }],
    },
    {
      code: "describe.skip('UserService', () => {});",
      filename: 'src/user-service.test.ts',
      errors: [{ messageId: 'disabledTestWithoutReason' }],
    },
  ],
});
