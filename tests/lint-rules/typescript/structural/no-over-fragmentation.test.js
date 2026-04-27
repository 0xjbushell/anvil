'use strict';

const fs = require('fs');
const path = require('path');

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/no-over-fragmentation.js');

const fixtureRoot = path.join(process.cwd(), 'tests/lint-rules/typescript/structural/fixtures/over-fragmentation');

function fixturePath(...segments) {
  return path.join(fixtureRoot, ...segments);
}

function readFixture(...segments) {
  return fs.readFileSync(fixturePath(...segments), 'utf8');
}

ruleTester.run('no-over-fragmentation', rule, {
  valid: [
    {
      code: readFixture('good', 'normal-dir', 'alpha.ts'),
      filename: fixturePath('good', 'normal-dir', 'alpha.ts'),
    },
    {
      code: readFixture('bad', 'many-tiny', 'beta.ts'),
      filename: fixturePath('bad', 'many-tiny', 'beta.ts'),
    },
    {
      code: readFixture('good', 'asset-dir', 'icons', 'alpha.ts'),
      filename: fixturePath('good', 'asset-dir', 'icons', 'alpha.ts'),
    },
    {
      code: readFixture('good', 'under-min-siblings', 'alpha.ts'),
      filename: fixturePath('good', 'under-min-siblings', 'alpha.ts'),
    },
    {
      code: readFixture('good', 'test-dir', '__tests__', 'alpha.ts'),
      filename: fixturePath('good', 'test-dir', '__tests__', 'alpha.ts'),
      options: [{ ignoreDirectories: ['__tests__'] }],
    },
    {
      code: readFixture('bad', 'many-tiny', 'alpha.ts'),
      filename: fixturePath('bad', 'many-tiny', 'alpha.ts'),
      options: [{ ignoreDirectories: ['many-tiny'] }],
    },
  ],
  invalid: [
    {
      code: readFixture('bad', 'many-tiny', 'alpha.ts'),
      filename: fixturePath('bad', 'many-tiny', 'alpha.ts'),
      errors: [{ messageId: 'overFragmentation' }],
    },
    {
      code: readFixture('bad', 'js-tiny', 'alpha.js'),
      filename: fixturePath('bad', 'js-tiny', 'alpha.js'),
      errors: [{ messageId: 'overFragmentation' }],
    },
    {
      code: readFixture('bad', 'mixed-tiny', 'alpha.ts'),
      filename: fixturePath('bad', 'mixed-tiny', 'alpha.ts'),
      options: [{ minSiblings: 4, tinyFractionThreshold: 0.6 }],
      errors: [{ messageId: 'overFragmentation' }],
    },
  ],
});
