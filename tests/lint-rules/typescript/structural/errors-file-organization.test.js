'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/errors-file-organization.js');

ruleTester.run('errors-file-organization', rule, {
  valid: [
    { code: 'export class ValidationError extends Error {}', filename: 'errors.ts' },
    { code: 'export class NotFoundError {}', filename: 'errors.tsx' },
    { code: 'export type ApiError = { message: string };', filename: 'errors.ts' },
    { code: 'export interface ApiError { message: string }', filename: 'errors.ts' },
    { code: 'type Problem = { message: string }; export { Problem as ApiError };', filename: 'errors.ts' },
    { code: 'class Problem {} export { Problem as ValidationError };', filename: 'errors.ts' },
    { code: 'export type ApiProblem = { message: string };', filename: 'api.ts' },
    { code: 'export interface ApiFailure { message: string }', filename: 'api.ts' },
    { code: 'class InternalError extends Error {}', filename: 'service.ts' },
    { code: 'export class UserService {}', filename: 'service.ts' },
    { code: 'export { ValidationError } from "./internal-errors";', filename: 'errors.ts' },
    { code: 'export { ValidationError } from "./errors";', filename: 'service.ts' },
  ],
  invalid: [
    {
      code: 'export class ValidationError extends Error {}',
      filename: 'service.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'export class NotFoundError {}',
      filename: 'models.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'class ValidationError extends Error {} export { ValidationError };',
      filename: 'service.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'class ValidationError {} export { ValidationError as Problem };',
      filename: 'service.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'export class DomainFailure extends Domain.Error {}',
      filename: 'service.tsx',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'export type ValidationError = { message: string };',
      filename: 'api.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'export interface ApiError { message: string }',
      filename: 'api.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'type Problem = { message: string }; export { Problem as ApiError };',
      filename: 'api.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'class Problem {} export { Problem as ValidationError };',
      filename: 'api.ts',
      errors: [{ messageId: 'errorOutsideErrorsFile' }],
    },
    {
      code: 'export type ValidationProblem = { message: string };',
      filename: 'errors.ts',
      errors: [{ messageId: 'nonErrorInErrorsFile' }],
    },
    {
      code: 'export interface ApiFailure { message: string }',
      filename: 'errors.ts',
      errors: [{ messageId: 'nonErrorInErrorsFile' }],
    },
    {
      code: 'export function helper() { return 1; }',
      filename: 'errors.ts',
      errors: [{ messageId: 'nonErrorInErrorsFile' }],
    },
    {
      code: 'function helper() { return 1; } export { helper };',
      filename: 'errors.ts',
      errors: [{ messageId: 'nonErrorInErrorsFile' }],
    },
    {
      code: 'export const ERROR_CODE = "E_VALIDATION";',
      filename: 'errors.tsx',
      errors: [{ messageId: 'nonErrorInErrorsFile' }],
    },
  ],
});
