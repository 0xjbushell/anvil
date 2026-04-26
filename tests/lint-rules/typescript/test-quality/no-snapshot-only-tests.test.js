'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/test-quality/no-snapshot-only-tests.js');

ruleTester.run('no-snapshot-only-tests', rule, {
  valid: [
    {
      code: "it('renders correctly', () => { const view = render(); expect(view).toMatchSnapshot(); expect(view.text).toBe('Hello'); });",
      filename: 'src/component.test.ts',
    },
    {
      code: "it('validates input', () => { expect(validate('abc')).toBe(true); });",
      filename: 'src/validate.spec.js',
    },
    {
      code: "it('has no assertions', () => { render(); });",
      filename: 'src/empty.test.ts',
    },
    {
      code: "it('source snapshot', () => { expect(render()).toMatchSnapshot(); });",
      filename: 'src/source.ts',
    },
  ],
  invalid: [
    {
      code: "it('renders correctly', () => { expect(render()).toMatchSnapshot(); });",
      filename: 'src/component.test.ts',
      errors: [{ messageId: 'snapshotOnlyTests' }],
    },
    {
      code: "it('renders inline', () => { expect(render()).toMatchInlineSnapshot(); });",
      filename: 'src/inline.spec.ts',
      errors: [{ messageId: 'snapshotOnlyTests' }],
    },
    {
      code: "it('renders list', () => { expect(renderList()).toMatchSnapshot(); }); it('renders item', () => { expect(renderItem()).toMatchInlineSnapshot(); });",
      filename: 'src/list.test.ts',
      errors: [{ messageId: 'snapshotOnlyTests' }],
    },
  ],
});
