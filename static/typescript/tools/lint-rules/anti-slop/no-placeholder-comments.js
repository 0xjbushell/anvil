'use strict';

const ACTIONABLE_REFERENCE = /\b[A-Z][A-Z0-9]+-\d+\b/;
const TODO_OR_FIXME = /\b(?:TODO|FIXME)\b/i;
const HACK = /\bHACK\b/i;
const PLACEHOLDER_PATTERNS = [
  /\bimplement(?:ed)?\s+(?:this\s+)?later\b/i,
  /\badd\s+.*\b(?:error|logging|validation|tests?|handling)\b/i,
  /\bplaceholder\b/i,
  /\bfill\s+(?:this\s+)?in\b/i,
  /\btemporary\b/i,
  /\bstub\b/i,
];

function isPlaceholderComment(commentText) {
  if (HACK.test(commentText)) {
    return true;
  }

  if (TODO_OR_FIXME.test(commentText)) {
    return !ACTIONABLE_REFERENCE.test(commentText);
  }

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(commentText));
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow vague placeholder comments without actionable context.',
      recommended: true,
    },
    messages: {
      placeholderComment: 'Placeholder comment detected. Either implement the TODO or remove it.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!isPlaceholderComment(comment.value)) {
            continue;
          }

          context.report({
            node: comment,
            messageId: 'placeholderComment',
          });
        }
      },
    };
  },
};
