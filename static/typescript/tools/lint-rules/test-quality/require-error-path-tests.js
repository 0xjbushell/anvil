'use strict';

const fs = require('fs');

const {
  getExpectMatcherName,
  getFilename,
  getFunctionArgument,
  getMemberPropertyName,
  getSourceFileCandidates,
  hasExpectChainProperty,
  isAssertCall,
  isTestFilename,
  unwrapExpression,
  visitNode,
} = require('./utils.js');

const ERROR_ASSERTION_MATCHERS = new Set(['toThrow', 'toThrowError']);
const ERROR_HANDLING_PATTERN = /\btry\s*\{|\bcatch\b|\.catch\s*\(|\bthrow\b/;

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
    .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '');
}

function findExistingSourceFile(filename) {
  return getSourceFileCandidates(filename).find((candidate) => fs.existsSync(candidate)) || null;
}

function sourceHasErrorHandling(filename) {
  return ERROR_HANDLING_PATTERN.test(stripCommentsAndStrings(fs.readFileSync(filename, 'utf8')));
}

function isAssertErrorCall(node) {
  const expression = unwrapExpression(node);
  const callee = unwrapExpression(expression?.callee);

  return (
    isAssertCall(expression) &&
    callee?.type === 'MemberExpression' &&
    ['throws', 'rejects'].includes(getMemberPropertyName(callee))
  );
}

function containsAssertion(node) {
  let found = false;

  visitNode(node, (current) => {
    if (
      current.type === 'CallExpression' &&
      (getExpectMatcherName(current) || isAssertCall(current))
    ) {
      found = true;
    }
  });

  return found;
}

function isPromiseCatchWithAssertion(node) {
  const callee = unwrapExpression(node.callee);

  if (
    callee?.type !== 'MemberExpression' ||
    getMemberPropertyName(callee) !== 'catch'
  ) {
    return false;
  }

  const callback = getFunctionArgument(node.arguments);
  return callback ? containsAssertion(callback.body) : false;
}

function hasErrorPathAssertion(programNode) {
  let found = false;

  visitNode(programNode, (node) => {
    if (node.type === 'CatchClause') {
      found = true;
    }

    if (node.type !== 'CallExpression') {
      return;
    }

    if (
      ERROR_ASSERTION_MATCHERS.has(getExpectMatcherName(node)) ||
      hasExpectChainProperty(node.callee, 'rejects') ||
      isAssertErrorCall(node) ||
      isPromiseCatchWithAssertion(node)
    ) {
      found = true;
    }
  });

  return found;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require tests for error paths when source code handles errors.',
      recommended: true,
    },
    messages: {
      missingErrorPathTests: 'Source file has error handling but this test file has no error-path assertions. Add tests for error cases using expect().toThrow() or expect().rejects.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const filename = getFilename(context);
        if (!isTestFilename(filename)) {
          return;
        }

        const sourceFile = findExistingSourceFile(filename);
        if (!sourceFile || !sourceHasErrorHandling(sourceFile) || hasErrorPathAssertion(node)) {
          return;
        }

        context.report({
          node,
          messageId: 'missingErrorPathTests',
        });
      },
    };
  },
};
