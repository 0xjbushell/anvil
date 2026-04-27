'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/enums-file-organization.js');

ruleTester.run('enums-file-organization', rule, {
  valid: [
    { code: 'export enum Status { Active, Inactive }', filename: 'enums.ts' },
    { code: 'export const enum Direction { Up, Down }', filename: 'enums.tsx' },
    { code: 'enum InternalStatus { Running, Stopped }', filename: 'service.ts' },
    { code: 'export class StatusService {}', filename: 'service.ts' },
    { code: 'export * from "./internal-enums";', filename: 'enums.ts' },
    { code: 'export { Status } from "./enums";', filename: 'service.ts' },
  ],
  invalid: [
    {
      code: 'export enum Status { Active, Inactive }',
      filename: 'service.ts',
      errors: [{ messageId: 'enumOutsideEnumsFile' }],
    },
    {
      code: 'export const enum Direction { Up, Down }',
      filename: 'direction.tsx',
      errors: [{ messageId: 'enumOutsideEnumsFile' }],
    },
    {
      code: 'enum Status { Active, Inactive } export { Status };',
      filename: 'service.ts',
      errors: [{ messageId: 'enumOutsideEnumsFile' }],
    },
    {
      code: 'export type Status = "active" | "inactive";',
      filename: 'enums.ts',
      errors: [{ messageId: 'nonEnumInEnumsFile' }],
    },
    {
      code: 'type Status = "active"; export { Status };',
      filename: 'enums.ts',
      errors: [{ messageId: 'nonEnumInEnumsFile' }],
    },
    {
      code: 'export const Status = { Active: "active" } as const;',
      filename: 'enums.tsx',
      errors: [{ messageId: 'nonEnumInEnumsFile' }],
    },
  ],
});
