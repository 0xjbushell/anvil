'use strict';

const SUPPRESSION_COMMENT_PATTERNS = [
  /\bintentionally\s+(?:ignored|ignoring|suppressed|suppressing|swallowed|swallowing)\b/i,
  /\bdeliberately\s+(?:ignored|ignoring|suppressed|suppressing|swallowed|swallowing)\b/i,
  /\bbest[-\s]?effort\s+cleanup\b/i,
  /\bnosec\b/i,
];

function isOnlyEmptyStatements(catchNode) {
  return catchNode.body.body.every((statement) => statement.type === 'EmptyStatement');
}

function isInsideBodyRange(comment, body) {
  if (!comment.range || !body.range) {
    return false;
  }

  return comment.range[0] >= body.range[0] && comment.range[1] <= body.range[1];
}

function hasSuppressionComment(sourceCode, catchNode) {
  return sourceCode
    .getAllComments()
    .filter((comment) => isInsideBodyRange(comment, catchNode.body))
    .some((comment) => (
      SUPPRESSION_COMMENT_PATTERNS.some((pattern) => pattern.test(comment.value))
    ));
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow empty catch blocks that silently swallow errors.',
      recommended: true,
    },
    messages: {
      silentErrorSwallow: 'Empty catch block silently swallows errors. Add handling or document intentional suppression.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        if (!isOnlyEmptyStatements(node)) {
          return;
        }

        if (hasSuppressionComment(context.sourceCode, node)) {
          return;
        }

        context.report({
          node,
          messageId: 'silentErrorSwallow',
        });
      },
    };
  },
};
