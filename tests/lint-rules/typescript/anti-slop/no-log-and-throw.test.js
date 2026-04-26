'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/no-log-and-throw.js');

ruleTester.run('no-log-and-throw', rule, {
  valid: [
    'function load() { try { foo(); } catch (err) { throw new AppError(err); } }',
    'function load() { try { foo(); } catch (err) { console.error(err); return null; } }',
    'function load(condition) { if (condition) { console.error("bad"); } else { throw new Error("fail"); } }',
    'function load() { try { foo(); } catch (err) { logger.error(err); recover(err); } }',
    'function load() { { console.log("about to fail"); throw new Error("fail"); } }',
  ],
  invalid: [
    {
      code: 'function load() { try { foo(); } catch (err) { console.error(err); throw err; } }',
      errors: [{ messageId: 'logAndThrow' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { logger.error("failed", err); throw new AppError(err); } }',
      errors: [{ messageId: 'logAndThrow' }],
    },
    {
      code: 'function load(err) { if (err) { console.log("about to fail"); throw err; } }',
      errors: [{ messageId: 'logAndThrow' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { console.warn(err); console.info("details"); throw err; } }',
      errors: [{ messageId: 'logAndThrow' }, { messageId: 'logAndThrow' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { console.error(err); return new Error("fail"); } }',
      errors: [{ messageId: 'logAndThrow' }],
    },
    {
      code: 'function load(err) { if (err) { logger.error("failed"); return new AppError("fail"); } }',
      errors: [{ messageId: 'logAndThrow' }],
    },
    {
      code: 'function load(debug) { try { foo(); } catch (err) { if (debug) { console.error(err); } throw err; } }',
      errors: [{ messageId: 'logAndThrow' }],
    },
  ],
});
