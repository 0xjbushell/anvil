'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/anti-slop/require-test-files.js');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-require-test-files-'));
const fixtureSourceDir = fixturePath('src');
const fixtureLibDir = fixturePath('lib');

function fixturePath(...segments) {
  return path.join(fixtureRoot, ...segments);
}

function writeFixture(relativePath, contents = 'export const value = 1;\n') {
  const filePath = fixturePath(...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

const sourceWithColocatedTest = writeFixture('src/with-test.ts');
writeFixture('src/with-test.test.ts', 'import { value } from "./with-test";\n');

const sourceWithSpecTest = writeFixture('src/with-spec.js');
writeFixture('src/with-spec.spec.ts', 'import { value } from "./with-spec";\n');

const sourceWithNestedTest = writeFixture('src/nested/feature.ts');
writeFixture('src/nested/__tests__/feature.test.js', 'import { value } from "../feature";\n');

const libSourceWithTest = writeFixture('lib/widget.ts');
writeFixture('lib/widget.test.js', 'import { value } from "./widget";\n');

ruleTester.run('require-test-files', rule, {
  valid: [
    {
      code: 'export function build() { return 1; }',
      filename: fixturePath('scripts', 'build.ts'),
    },
    {
      code: 'export interface User { id: string }',
      filename: fixturePath('src', 'types.ts'),
      options: [{ sourceDir: fixtureSourceDir }],
    },
    {
      code: 'export { helper } from "./helper";',
      filename: fixturePath('src', 'nested', 'index.ts'),
      options: [{ sourceDir: fixtureSourceDir }],
    },
    {
      code: 'export const value = 1;',
      filename: sourceWithColocatedTest,
      options: [{ sourceDir: fixtureSourceDir }],
    },
    {
      code: 'export const value = 1;',
      filename: sourceWithSpecTest,
      options: [{ sourceDir: fixtureSourceDir }],
    },
    {
      code: 'export const value = 1;',
      filename: sourceWithNestedTest,
      options: [{ sourceDir: fixtureSourceDir }],
    },
    {
      code: 'test("works", () => expect(true).toBe(true));',
      filename: fixturePath('src', 'missing.test.ts'),
      options: [{ sourceDir: fixtureSourceDir }],
    },
    {
      code: 'export function helper() { return 1; }',
      filename: path.join(process.cwd(), 'tests', 'src', 'helper.ts'),
    },
    {
      code: 'export const value = 1;',
      filename: libSourceWithTest,
      options: [{ sourceDir: fixtureLibDir }],
    },
  ],
  invalid: [
    {
      code: 'export function loadUser(id) { return id; }',
      filename: fixturePath('src', 'missing.ts'),
      options: [{ sourceDir: fixtureSourceDir }],
      errors: [{ messageId: 'missingTestFile' }],
    },
    {
      code: 'export const parse = (input) => input.trim();',
      filename: fixturePath('src', 'nested', 'parse.js'),
      options: [{ sourceDir: fixtureSourceDir }],
      errors: [{ messageId: 'missingTestFile' }],
    },
    {
      code: 'export function make() { return 1; }',
      filename: fixturePath('src', 'feature', 'index.ts'),
      options: [{ sourceDir: fixtureSourceDir }],
      errors: [{ messageId: 'missingTestFile' }],
    },
    {
      code: 'export const value = 1;',
      filename: fixturePath('lib', 'missing.ts'),
      options: [{ sourceDir: fixtureLibDir }],
      errors: [{ messageId: 'missingTestFile' }],
    },
  ],
});
