'use strict';

const fs = require('fs');
const path = require('path');

const { getFilename } = require('./utils.js');

const SOURCE_FILE_PATTERN = /\.(?:ts|tsx|js|mjs)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\./;
const INDEX_FILE_PATTERN = /^index\.(?:ts|tsx|js|mjs)$/;
const DEFAULT_IGNORE_DIRECTORIES = ['icons', 'assets', '__generated__', 'migrations'];

function getOptions(context) {
  const [options = {}] = context.options;
  return {
    ignoreDirectories: options.ignoreDirectories || DEFAULT_IGNORE_DIRECTORIES,
    minSiblings: options.minSiblings || 4,
    tinyLineThreshold: options.tinyLineThreshold || 30,
    tinyFractionThreshold: options.tinyFractionThreshold ?? 0.6,
  };
}

function normalizePath(filename, cwd) {
  return path.normalize(path.isAbsolute(filename) ? filename : path.resolve(cwd, filename));
}

function shouldIgnoreDirectory(dir, ignoreDirectories) {
  const ignored = new Set(ignoreDirectories.map((entry) => String(entry).toLowerCase()));
  return dir
    .split(path.sep)
    .map((segment) => segment.toLowerCase())
    .some((segment) => ignored.has(segment));
}

function isCandidateSourceFile(filename) {
  return (
    SOURCE_FILE_PATTERN.test(filename) &&
    !TEST_FILE_PATTERN.test(filename) &&
    !INDEX_FILE_PATTERN.test(filename)
  );
}

function listSiblingSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isCandidateSourceFile(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function countLogicalLines(source) {
  return stripComments(source)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function countExportSites(source) {
  const stripped = stripComments(source);
  return (
    countMatches(stripped, /^\s*export\s+(?:const|let|var|function|class|interface|type|enum|default|async\s+function)\b/gm) +
    countMatches(stripped, /^\s*export\s*\{/gm) +
    countMatches(stripped, /^\s*export\s*\*/gm)
  );
}

function isTinySingleExport(filePath, tinyLineThreshold) {
  const source = fs.readFileSync(filePath, 'utf8');
  return countLogicalLines(source) < tinyLineThreshold && countExportSites(source) <= 1;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow directories dominated by tiny single-purpose source files.',
      recommended: true,
    },
    messages: {
      overFragmentation: "Directory '{{ dir }}' is over-fragmented ({{ tinyCount }}/{{ siblingCount }} files are tiny single-purpose wrappers). Consider consolidating related logic into fewer cohesive modules.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          ignoreDirectories: { type: 'array', items: { type: 'string' }, default: DEFAULT_IGNORE_DIRECTORIES },
          minSiblings: { type: 'integer', minimum: 2, default: 4 },
          tinyLineThreshold: { type: 'integer', minimum: 1, default: 30 },
          tinyFractionThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.6 },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = getOptions(context);
    const cwd = context.cwd || process.cwd();

    return {
      Program(node) {
        const rawFilename = getFilename(context);
        if (!rawFilename || rawFilename === '<input>') {
          return;
        }

        const filename = normalizePath(rawFilename, cwd);
        const dir = path.dirname(filename);

        if (shouldIgnoreDirectory(dir, options.ignoreDirectories)) {
          return;
        }

        const siblingFiles = fs.existsSync(dir) ? listSiblingSourceFiles(dir) : [];

        if (siblingFiles.length === 0 || path.basename(filename) !== siblingFiles[0]) {
          return;
        }

        let tinyCount = 0;
        for (const siblingFile of siblingFiles) {
          if (isTinySingleExport(path.join(dir, siblingFile), options.tinyLineThreshold)) {
            tinyCount += 1;
          }
        }

        const siblingCount = siblingFiles.length;
        if (
          siblingCount >= options.minSiblings &&
          tinyCount / siblingCount >= options.tinyFractionThreshold
        ) {
          context.report({
            node,
            messageId: 'overFragmentation',
            data: {
              dir,
              tinyCount,
              siblingCount,
            },
          });
        }
      },
    };
  },
};
