'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/filename-match-export.js');

ruleTester.run('filename-match-export', rule, {
  valid: [
    { code: 'export function userService() { return null; }', filename: 'userService.ts' },
    { code: 'export class UserService {}', filename: 'UserService.ts' },
    { code: 'export function userService() { return null; }', filename: 'user-service.ts' },
    { code: 'export type UserService = { id: string };', filename: 'user_service.ts' },
    { code: 'export function anything() { return null; }', filename: 'index.ts' },
    { code: 'export type Anything = string;', filename: 'types.ts' },
    { code: 'export class AnythingError extends Error {}', filename: 'errors.ts' },
    { code: 'export const ANYTHING = 1;', filename: 'constants.ts' },
    { code: 'export enum Anything { One }', filename: 'enums.ts' },
    { code: 'export function first() {}\nexport function second() {}', filename: 'service.ts' },
    { code: 'export { UserService } from "./user-service";', filename: 'service.ts' },
    { code: 'class Internal {} export { Internal as UserService };', filename: 'user-service.ts' },
  ],
  invalid: [
    {
      code: 'export function dataProcessor() { return null; }',
      filename: 'userService.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
    {
      code: 'export class AuthenticationManager {}',
      filename: 'auth.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
    {
      code: 'export interface AccountRecord { id: string }',
      filename: 'user-record.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
    {
      code: 'export const settings = {};',
      filename: 'config.js',
      errors: [{ messageId: 'filenameMismatch' }],
    },
    {
      code: 'export { Shared } from "./shared";\nexport function wrongName() { return null; }',
      filename: 'right-name.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
    {
      code: 'function wrongName() { return null; } export { wrongName };',
      filename: 'right-name.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
    {
      code: 'class UserService {} export { UserService as Internal };',
      filename: 'user-service.ts',
      errors: [{ messageId: 'filenameMismatch' }],
    },
  ],
});
