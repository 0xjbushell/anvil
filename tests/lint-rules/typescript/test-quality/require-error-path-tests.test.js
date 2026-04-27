'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/test-quality/require-error-path-tests.js');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-require-error-path-tests-'));

function fixturePath(...segments) {
  return path.join(fixtureRoot, ...segments);
}

function writeFixture(relativePath, contents) {
  const filePath = fixturePath(...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

const noErrorSource = writeFixture(
  'src/no-error.ts',
  'export function read(id) { return id; }\n',
);
const throwingSource = writeFixture(
  'src/throwing.ts',
  'export function validate(input) { if (!input) { throw new Error("invalid"); } return input; }\n',
);
const promiseSource = writeFixture(
  'src/promise.js',
  'export function load() { return fetch("/api").catch((error) => { throw error; }); }\n',
);
const mirroredSource = writeFixture(
  'src/nested/mirrored.ts',
  'export function parse(value) { try { return JSON.parse(value); } catch (error) { throw error; } }\n',
);
const commentOnlySource = writeFixture(
  'src/comment-only.ts',
  'export function read() { const note = "catch this label"; return note; }\n// throw on invalid input later\n',
);

ruleTester.run('require-error-path-tests', rule, {
  valid: [
    {
      code: "it('happy path only is fine without source errors', () => { expect(read(1)).toBe(1); });",
      filename: noErrorSource.replace(/\.ts$/, '.test.ts'),
    },
    {
      code: "it('throws on invalid input', () => { expect(() => validate(null)).toThrow(); });",
      filename: throwingSource.replace(/\.ts$/, '.test.ts'),
    },
    {
      code: "it('rejects failed load', async () => { await expect(load()).rejects.toThrow(); });",
      filename: promiseSource.replace(/\.js$/, '.spec.js'),
    },
    {
      code: "it('uses assert throws', () => { assert.throws(() => parse('bad')); });",
      filename: fixturePath('tests', 'nested', 'mirrored.test.ts'),
    },
    {
      code: "it('handles promise catch', () => load().catch((error) => { expect(error.message).toBe('bad'); }));",
      filename: promiseSource.replace(/\.js$/, '.spec.js'),
    },
    {
      code: "it('ignores comments and strings mentioning errors', () => { expect(read()).toBe('catch this label'); });",
      filename: commentOnlySource.replace(/\.ts$/, '.test.ts'),
    },
    {
      code: "it('ignores source files', () => { expect(true).toBe(true); });",
      filename: fixturePath('src', 'throwing.ts'),
    },
  ],
  invalid: [
    {
      code: "it('returns input', () => { expect(validate('abc')).toBe('abc'); });",
      filename: throwingSource.replace(/\.ts$/, '.test.ts'),
      errors: [{ messageId: 'missingErrorPathTests' }],
    },
    {
      code: "it('loads data', async () => { expect(await load()).toBeDefined(); });",
      filename: promiseSource.replace(/\.js$/, '.spec.js'),
      errors: [{ messageId: 'missingErrorPathTests' }],
    },
    {
      code: "it('parses valid json', () => { expect(parse('{\"ok\":true}')).toEqual({ ok: true }); });",
      filename: fixturePath('tests', 'nested', 'mirrored.test.ts'),
      errors: [{ messageId: 'missingErrorPathTests' }],
    },
  ],
});
