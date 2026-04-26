'use strict';

const { ruleTester } = require('../helpers.js');
const rule = require('../../../../static/typescript/tools/lint-rules/structural/constants-file-organization.js');

ruleTester.run('constants-file-organization', rule, {
  valid: [
    { code: 'export const MAX_RETRIES = 3;', filename: 'constants.ts' },
    { code: 'export const DEFAULT_LANGUAGE = Language.English;', filename: 'constants.ts' },
    {
      code: 'export const GREETINGS = { [Language.English]: "Hello", [Language.Spanish]: "Hola" } as const;',
      filename: 'constants.ts',
    },
    { code: 'export const CONFIG = { retries: 3, labels: ["fast"] } as const;', filename: 'constants.tsx' },
    { code: 'export const client = createClient();', filename: 'service.ts' },
    { code: 'export const DEFAULT_PORT = process.env.PORT;', filename: 'service.ts' },
    { code: 'const API_URL = "https://api.example.com";', filename: 'service.ts' },
    { code: 'export const handler = () => 1;', filename: 'service.ts' },
    { code: 'export { MAX_RETRIES } from "./internal-constants";', filename: 'constants.ts' },
    { code: 'export { MAX_RETRIES } from "./constants";', filename: 'service.ts' },
  ],
  invalid: [
    {
      code: 'export const API_URL = "https://api.example.com";',
      filename: 'service.ts',
      errors: [{ messageId: 'constantOutsideConstantsFile' }],
    },
    {
      code: 'export const MAX_RETRIES = 3;',
      filename: 'settings.tsx',
      errors: [{ messageId: 'constantOutsideConstantsFile' }],
    },
    {
      code: 'const API_URL = "https://api.example.com"; export { API_URL };',
      filename: 'service.ts',
      errors: [{ messageId: 'constantOutsideConstantsFile' }],
    },
    {
      code: 'export const COLORS = ["red", "green", "blue"] as const;',
      filename: 'theme.ts',
      errors: [{ messageId: 'constantOutsideConstantsFile' }],
    },
    {
      code: 'export const DEFAULT_LANGUAGE = Language.English;',
      filename: 'language.ts',
      errors: [{ messageId: 'constantOutsideConstantsFile' }],
    },
    {
      code: 'export const GREETINGS = { [Language.English]: "Hello" } as const;',
      filename: 'greetings.ts',
      errors: [{ messageId: 'constantOutsideConstantsFile' }],
    },
    {
      code: 'export const client = createClient();',
      filename: 'constants.ts',
      errors: [{ messageId: 'nonConstantInConstantsFile' }],
    },
    {
      code: 'export const DEFAULT_PORT = process.env.PORT;',
      filename: 'constants.ts',
      errors: [{ messageId: 'nonConstantInConstantsFile' }],
    },
    {
      code: 'const client = createClient(); export { client };',
      filename: 'constants.ts',
      errors: [{ messageId: 'nonConstantInConstantsFile' }],
    },
    {
      code: 'export function helper() { return 1; }',
      filename: 'constants.tsx',
      errors: [{ messageId: 'nonConstantInConstantsFile' }],
    },
  ],
});
