'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/no-placeholder-comments.js');

ruleTester.run('no-placeholder-comments', rule, {
  valid: [
    '// TODO(PROJ-123): Optimize query performance\nconst value = 1;',
    '// FIXME GH-456: Race condition in cache invalidation\nconst value = 1;',
    '// TODO(PROJ-123): add error handling for failed imports\nconst value = 1;',
    '// FIXME GH-456: temporary workaround until cache invalidation ships\nconst value = 1;',
    '// This function handles user authentication\nconst value = 1;',
    '// Contemporary browsers support this API\nconst value = 1;',
  ],
  invalid: [
    {
      code: '// TODO: fix this later\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// implement later\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// add error handling\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// placeholder\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// fill in the logic\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// temporary workaround\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// HACK: quick fix\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '// HACK(OPS-789): Compatibility shim for legacy importer\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
    {
      code: '/* stub */\nconst value = 1;',
      errors: [{ messageId: 'placeholderComment' }],
    },
  ],
});
