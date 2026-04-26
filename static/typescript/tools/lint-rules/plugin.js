'use strict';

const noLogAndContinue = require('./anti-slop/no-log-and-continue.js');
const noErrorObscuring = require('./anti-slop/no-error-obscuring.js');
const noPlaceholderComments = require('./anti-slop/no-placeholder-comments.js');
const noLogAndThrow = require('./anti-slop/no-log-and-throw.js');
const noPassThroughWrapper = require('./anti-slop/no-pass-through-wrapper.js');
const requireStructuredLogging = require('./anti-slop/require-structured-logging.js');
const requireTestFiles = require('./anti-slop/require-test-files.js');
const noAsyncNoise = require('./anti-slop/no-async-noise.js');
const noSilentErrorSwallow = require('./error-handling/no-silent-error-swallow.js');
const typesFileOrganization = require('./structural/types-file-organization.js');
const errorsFileOrganization = require('./structural/errors-file-organization.js');
const constantsFileOrganization = require('./structural/constants-file-organization.js');
const enumsFileOrganization = require('./structural/enums-file-organization.js');
const filenameMatchExport = require('./structural/filename-match-export.js');
const noExportedFunctionExpressions = require('./structural/no-exported-function-expressions.js');
const noBarrelDensity = require('./structural/no-barrel-density.js');
const noOverFragmentation = require('./structural/no-over-fragmentation.js');

const rules = {
  'no-log-and-continue': noLogAndContinue,
  'no-error-obscuring': noErrorObscuring,
  'no-placeholder-comments': noPlaceholderComments,
  'no-log-and-throw': noLogAndThrow,
  'no-pass-through-wrapper': noPassThroughWrapper,
  'require-structured-logging': requireStructuredLogging,
  'require-test-files': requireTestFiles,
  'no-async-noise': noAsyncNoise,
  'no-silent-error-swallow': noSilentErrorSwallow,
  'types-file-organization': typesFileOrganization,
  'errors-file-organization': errorsFileOrganization,
  'constants-file-organization': constantsFileOrganization,
  'enums-file-organization': enumsFileOrganization,
  'filename-match-export': filenameMatchExport,
  'no-exported-function-expressions': noExportedFunctionExpressions,
  'no-barrel-density': noBarrelDensity,
  'no-over-fragmentation': noOverFragmentation,
};

const plugin = {
  rules,
  configs: {},
};

plugin.configs.recommended = {
  plugins: { anvil: plugin },
  rules: {
    'anvil/no-log-and-continue': 'error',
    'anvil/no-error-obscuring': 'error',
    'anvil/no-placeholder-comments': 'error',
    'anvil/no-log-and-throw': 'error',
    'anvil/no-pass-through-wrapper': 'error',
    'anvil/require-structured-logging': 'error',
    'anvil/require-test-files': 'error',
    'anvil/no-async-noise': 'error',
    'anvil/no-silent-error-swallow': 'error',
    'anvil/types-file-organization': 'error',
    'anvil/errors-file-organization': 'error',
    'anvil/constants-file-organization': 'error',
    'anvil/enums-file-organization': 'error',
    'anvil/filename-match-export': 'error',
    'anvil/no-exported-function-expressions': 'error',
    'anvil/no-barrel-density': 'error',
    'anvil/no-over-fragmentation': 'error',
  },
};

module.exports = plugin;
