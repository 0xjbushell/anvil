"use strict";

const {
  getFilename,
  getFirstStringArgument,
  getFunctionArgument,
  isAssertionCall,
  isRunnableTestCall,
  isTestFilename,
  unwrapExpression,
  visitNode,
} = require("./utils.js");

function hasAssertions(callback) {
  let foundAssertion = false;

  visitNode(
    unwrapExpression(callback.body),
    (node) => {
      if (isAssertionCall(node)) {
        foundAssertion = true;
      }
    },
    { skipNestedFunctions: true },
  );

  return foundAssertion;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow test cases without assertions.",
      recommended: true,
    },
    messages: {
      emptyTest: "Test '{{ testName }}' has no assertions. Add expect() or assert() calls.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isTestFilename(getFilename(context)) || !isRunnableTestCall(node)) {
          return;
        }

        const callback = getFunctionArgument(node.arguments);
        if (!callback || hasAssertions(callback)) {
          return;
        }

        context.report({
          node,
          messageId: "emptyTest",
          data: { testName: getFirstStringArgument(node.arguments) },
        });
      },
    };
  },
};
