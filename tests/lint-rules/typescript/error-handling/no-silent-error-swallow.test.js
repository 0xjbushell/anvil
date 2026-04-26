'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/error-handling/no-silent-error-swallow.js');

ruleTester.run('no-silent-error-swallow', rule, {
  valid: [
    'function load() { try { foo(); } catch (err) { throw err; } }',
    'function load() { try { foo(); } catch (err) { console.error(err); } }',
    'function load() { try { foo(); } catch (err) { recover(err); } }',
    'function load() { try { foo(); } catch (err) { // intentionally ignored\n } }',
    'function load() { try { foo(); } catch (err) { // best-effort cleanup\n ; } }',
    'function load() { try { foo(); } catch (err) { // nosec\n } }',
  ],
  invalid: [
    {
      code: 'function load() { try { foo(); } catch (err) { } }',
      errors: [{ messageId: 'silentErrorSwallow' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { ; } }',
      errors: [{ messageId: 'silentErrorSwallow' }],
    },
    {
      code: 'function load() { try { foo(); } catch (err) { ; ; } }',
      errors: [{ messageId: 'silentErrorSwallow' }],
    },
    {
      code: 'function load() { try { foo(); } catch { } }',
      errors: [{ messageId: 'silentErrorSwallow' }],
    },
  ],
});
