'use strict';

const fs = require('fs');
const path = require('path');

const DECLARATION_ONLY_FILES = new Set(['types', 'errors', 'constants', 'enums']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_SUFFIXES = [
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.spec.js',
];

function resolvePath(cwd, filePath) {
  return path.normalize(path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath));
}

function resolveSourceDir(cwd, sourceDir) {
  return resolvePath(cwd, sourceDir || 'src');
}

function isInsideSourceDir(filename, sourceDir) {
  const relativePath = path.relative(sourceDir, filename);

  return (
    relativePath === '' ||
    (
      relativePath.length > 0 &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath)
    )
  );
}

function isTestFile(filename) {
  return TEST_FILE_PATTERN.test(path.basename(filename));
}

function isDeclarationOnlyFile(filename) {
  const parsed = path.parse(filename);
  return DECLARATION_ONLY_FILES.has(parsed.name);
}

function isBarrelIndex(filename, programNode) {
  const parsed = path.parse(filename);

  if (parsed.name !== 'index' || programNode.body.length === 0) {
    return false;
  }

  return programNode.body.every((statement) => (
    statement.type === 'ExportAllDeclaration' ||
    (
      statement.type === 'ExportNamedDeclaration' &&
      Boolean(statement.source)
    )
  ));
}

function getCandidateTestPaths(filename) {
  const parsed = path.parse(filename);
  const colocated = TEST_SUFFIXES.map((suffix) => path.join(parsed.dir, `${parsed.name}${suffix}`));
  const nested = TEST_SUFFIXES.map((suffix) => (
    path.join(parsed.dir, '__tests__', `${parsed.name}${suffix}`)
  ));

  return [...colocated, ...nested];
}

function hasCorrespondingTestFile(filename) {
  return getCandidateTestPaths(filename).some((candidatePath) => fs.existsSync(candidatePath));
}

function getOptions(context) {
  const [options = {}] = context.options;
  return {
    sourceDir: options.sourceDir || 'src',
  };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require source files to have corresponding test files.',
      recommended: true,
    },
    messages: {
      missingTestFile: 'Source file has no corresponding test file. Create {{ expectedPath }}.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          sourceDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = getOptions(context);
    const cwd = context.cwd || process.cwd();
    const sourceDir = resolveSourceDir(cwd, options.sourceDir);

    return {
      Program(node) {
        const rawFilename = context.filename;

        if (!rawFilename || rawFilename === '<input>') {
          return;
        }

        const filename = resolvePath(cwd, rawFilename);
        const extension = path.extname(filename);

        if (
          !SOURCE_EXTENSIONS.has(extension) ||
          !isInsideSourceDir(filename, sourceDir) ||
          isTestFile(filename) ||
          isDeclarationOnlyFile(filename) ||
          isBarrelIndex(filename, node) ||
          hasCorrespondingTestFile(filename)
        ) {
          return;
        }

        context.report({
          node,
          messageId: 'missingTestFile',
          data: { expectedPath: getCandidateTestPaths(filename)[0] },
        });
      },
    };
  },
};
