'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/no-log-and-continue.js');

ruleTester.run('no-log-and-continue', rule, {
  valid: [
    'function load() { try { foo(); } catch (err) { console.error(err); throw err; } }',
    'function load() { try { foo(); } catch (err) { logger.error("failed", err); return null; } }',
    'function load() { try { foo(); } catch (err) { console.warn(err); fallback(); } }',
    'function load() { try { foo(); } catch (err) { } }',
    'function load() { try { foo(); } catch (err) { throw new AppError(err); } }',
  ],
  invalid: [
    {
      code: 'function load() { try { foo(); } catch (err) { console.error(err); } }',
      errors: [{ messageId: 'logAndContinue' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { console.log("error", err); } }',
      errors: [{ messageId: 'logAndContinue' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { logger.error("failed", err); } }',
      errors: [{ messageId: 'logAndContinue' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { console.error(err); log.warn("details"); } }',
      errors: [{ messageId: 'logAndContinue' }],
    },
    {
      code: 'function load(debug) { try { foo(); } catch (err) { if (debug) { console.error(err); } } }',
      errors: [{ messageId: 'logAndContinue' }],
    },
  ],
});
