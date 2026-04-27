'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/no-pass-through-wrapper.js');

ruleTester.run('no-pass-through-wrapper', rule, {
  valid: [
    'function getData(id) { return fetchData(id, { cache: true }); }',
    'function getData(id) { return fetchData(parseInt(id, 10)); }',
    'function getData(id) { validate(id); return fetchData(id); }',
    'function getData(id, opts) { return fetchData(id); }',
    'const getData = (id) => { const key = normalize(id); return fetchData(key); };',
    'function getData({ id }) { return fetchData(id); }',
    'function getData(id, opts) { return fetchData(opts, id); }',
  ],
  invalid: [
    {
      code: 'function getData(id) { return fetchData(id); }',
      errors: [{ messageId: 'passThroughWrapper' }],
    },
    {
      code: 'const getData = (id) => { return fetchData(id); };',
      errors: [{ messageId: 'passThroughWrapper' }],
    },
    {
      code: 'const getData = (id) => fetchData(id);',
      errors: [{ messageId: 'passThroughWrapper' }],
    },
    {
      code: 'function process(a, b, c) { return doProcess(a, b, c); }',
      errors: [{ messageId: 'passThroughWrapper' }],
    },
    {
      code: 'const save = async (record, options) => persist(record, options);',
      errors: [{ messageId: 'passThroughWrapper' }],
    },
  ],
});
