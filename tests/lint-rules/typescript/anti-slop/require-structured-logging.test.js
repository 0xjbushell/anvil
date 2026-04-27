'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/require-structured-logging.js');

ruleTester.run('require-structured-logging', rule, {
  valid: [
    'logger.info("user logged in", { userId: 123 });',
    'logger.error("connection failed");',
    'format(`Hello ${name}`);',
    'console.log("handled by no-console, not this rule");',
    'console.info(`User ${userId} logged in`);',
    'console.error("Failed to process " + item);',
    'audit.info(`User ${userId} logged in`);',
    {
      code: 'auditLog.info({ userId }, "user logged in");',
      options: [{ structuredLoggers: ['auditLog'] }],
    },
  ],
  invalid: [
    {
      code: 'logger.info(`User ${userId} logged in`);',
      errors: [{ messageId: 'unstructuredLog' }],
    },
    {
      code: 'logger.error("Failed to process " + item);',
      errors: [{ messageId: 'unstructuredLog' }],
    },
    {
      code: 'pino.warn(`Retry ${attempt} failed`);',
      errors: [{ messageId: 'unstructuredLog' }],
    },
    {
      code: 'winston.info("User " + userId + " logged in");',
      errors: [{ messageId: 'unstructuredLog' }],
    },
    {
      code: 'auditLog.info(`User ${userId} logged in`);',
      options: [{ structuredLoggers: ['auditLog'] }],
      errors: [{ messageId: 'unstructuredLog' }],
    },
  ],
});
