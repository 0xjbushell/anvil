'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/types-file-organization.js');

ruleTester.run('types-file-organization', rule, {
  valid: [
    { code: 'export type UserId = string;', filename: 'types.ts' },
    { code: 'export interface User { id: string }', filename: 'types.tsx' },
    { code: 'type InternalState = { count: number };', filename: 'service.ts' },
    { code: 'export function getUser() { return null; }', filename: 'service.ts' },
    { code: 'export { User } from "./internal-types";', filename: 'types.ts' },
    { code: 'export { User } from "./types";', filename: 'service.ts' },
  ],
  invalid: [
    {
      code: 'export type UserId = string;',
      filename: 'service.ts',
      errors: [{ messageId: 'typeOutsideTypesFile' }],
    },
    {
      code: 'export interface User { id: string }',
      filename: 'models.tsx',
      errors: [{ messageId: 'typeOutsideTypesFile' }],
    },
    {
      code: 'type UserId = string; export { UserId };',
      filename: 'service.ts',
      errors: [{ messageId: 'typeOutsideTypesFile' }],
    },
    {
      code: 'export function helper() { return 1; }',
      filename: 'types.ts',
      errors: [{ messageId: 'nonTypeInTypesFile' }],
    },
    {
      code: 'function helper() { return 1; } export { helper };',
      filename: 'types.ts',
      errors: [{ messageId: 'nonTypeInTypesFile' }],
    },
    {
      code: 'export class UserService {}',
      filename: 'types.tsx',
      errors: [{ messageId: 'nonTypeInTypesFile' }],
    },
  ],
});
