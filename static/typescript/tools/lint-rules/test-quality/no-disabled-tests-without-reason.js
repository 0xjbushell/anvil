"use strict";

const { getFilename, getSourceCode, isSkippedTestCall, isTestFilename } = require("./utils.js");

function isExplanationComment(comment) {
  return comment.value.trim().length > 0;
}

function hasNearbyExplanation(sourceCode, node) {
  const nodeLine = node.loc.start.line;

  return sourceCode
    .getAllComments()
    .some(
      (comment) =>
        isExplanationComment(comment) &&
        (comment.loc.end.line === nodeLine - 1 ||
          comment.loc.start.line === nodeLine ||
          comment.loc.end.line === nodeLine),
    );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require disabled tests to explain why they are skipped.",
      recommended: true,
    },
    messages: {
      disabledTestWithoutReason:
        "Disabled test without explanation. Add a comment explaining why this test is skipped.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = getSourceCode(context);

    return {
      CallExpression(node) {
        if (
          !isTestFilename(getFilename(context)) ||
          !isSkippedTestCall(node) ||
          hasNearbyExplanation(sourceCode, node)
        ) {
          return;
        }

        context.report({
          node,
          messageId: "disabledTestWithoutReason",
        });
      },
    };
  },
};
