'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/no-error-obscuring.js');

ruleTester.run('no-error-obscuring', rule, {
  valid: [
    'function load() { try { foo(); } catch (err) { throw err; } }',
    'function load() { try { foo(); } catch (err) { throw new Error("failed", { cause: err }); } }',
    'function load() { try { foo(); } catch (err) { return { error: err.message }; } }',
    'function load() { try { foo(); } catch (err) { throw new AppError("context", err); } }',
    'function load() { try { foo(); } catch (err) { console.error(err); return null; } }',
  ],
  invalid: [
    {
      code: 'function load() { try { foo(); } catch (err) { return null; } }',
      errors: [{ messageId: 'defaultReturn' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { return []; } }',
      errors: [{ messageId: 'defaultReturn' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { return false; } }',
      errors: [{ messageId: 'defaultReturn' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { return undefined; } }',
      errors: [{ messageId: 'defaultReturn' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { throw new Error("Something went wrong"); } }',
      errors: [{ messageId: 'genericThrow' }],
    },
    {
      code: 'function load() { try { foo(); } catch { throw new Error("failed"); } }',
      errors: [{ messageId: 'genericThrow' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { throw new Error("failed", { err: true }); } }',
      errors: [{ messageId: 'genericThrow' }],
    },
    {
      code: 'function load(debug) { try { foo(); } catch (err) { if (debug) { console.error(err); } return null; } }',
      errors: [{ messageId: 'defaultReturn' }],
    },
  ],
});
