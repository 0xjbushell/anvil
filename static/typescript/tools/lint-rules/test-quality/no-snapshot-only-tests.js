'use strict';

const {
  getExpectMatcherName,
  getFilename,
  isAssertCall,
  isTestFilename,
  visitNode,
} = require('./utils.js');

const SNAPSHOT_MATCHERS = new Set(['toMatchSnapshot', 'toMatchInlineSnapshot']);

function analyzeAssertions(programNode) {
  const analysis = {
    hasSnapshotAssertion: false,
    hasBehavioralAssertion: false,
  };

  visitNode(programNode, (node) => {
    if (node.type !== 'CallExpression') {
      return;
    }

    const matcherName = getExpectMatcherName(node);
    if (matcherName) {
      if (SNAPSHOT_MATCHERS.has(matcherName)) {
        analysis.hasSnapshotAssertion = true;
      } else {
        analysis.hasBehavioralAssertion = true;
      }
    }

    if (isAssertCall(node)) {
      analysis.hasBehavioralAssertion = true;
    }
  });

  return analysis;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require behavioral assertions alongside snapshot assertions.',
      recommended: true,
    },
    messages: {
      snapshotOnlyTests: 'Test file uses only snapshot assertions. Add behavioral assertions (toBe, toEqual, toThrow, etc.) alongside snapshots.',
    },
    schema: [],
  },
  create(context) {
    return {
      'Program:exit'(node) {
        if (!isTestFilename(getFilename(context))) {
          return;
        }

        const analysis = analyzeAssertions(node);
        if (analysis.hasSnapshotAssertion && !analysis.hasBehavioralAssertion) {
          context.report({
            node,
            messageId: 'snapshotOnlyTests',
          });
        }
      },
    };
  },
};
