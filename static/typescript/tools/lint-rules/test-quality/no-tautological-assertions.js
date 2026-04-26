'use strict';

const {
  getExpectMatcherName,
  getFilename,
  hasExpectChainProperty,
  isTestFilename,
  unwrapExpression,
} = require('./utils.js');

const SAME_VALUE_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);

function getExpectedArgument(node) {
  const calleeObject = unwrapExpression(unwrapExpression(node.callee)?.object);

  if (calleeObject?.type === 'CallExpression') {
    return calleeObject.arguments[0] || null;
  }

  if (calleeObject?.type === 'MemberExpression') {
    return getExpectedArgument({ callee: calleeObject, arguments: [] });
  }

  return null;
}

function getLiteralKey(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return null;
  }

  if (expression.type === 'Literal') {
    return `${typeof expression.value}:${String(expression.value)}`;
  }

  if (expression.type === 'Identifier' && expression.name === 'undefined') {
    return 'undefined:undefined';
  }

  if (
    expression.type === 'UnaryExpression' &&
    ['-', '+'].includes(expression.operator) &&
    expression.argument.type === 'Literal' &&
    typeof expression.argument.value === 'number'
  ) {
    return `number:${String(Number(`${expression.operator}${expression.argument.value}`))}`;
  }

  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return `string:${expression.quasis.map((quasi) => quasi.value.cooked || '').join('')}`;
  }

  return null;
}

function hasSameLiteralAssertion(node) {
  const matcherName = getExpectMatcherName(node);

  if (
    !SAME_VALUE_MATCHERS.has(matcherName) ||
    node.arguments.length === 0 ||
    hasExpectChainProperty(node.callee, 'not')
  ) {
    return false;
  }

  const actualKey = getLiteralKey(getExpectedArgument(node));
  const expectedKey = getLiteralKey(node.arguments[0]);

  return actualKey !== null && actualKey === expectedKey;
}

function hasAlwaysTrueBooleanAssertion(node) {
  if (hasExpectChainProperty(node.callee, 'not')) {
    return false;
  }

  const matcherName = getExpectMatcherName(node);
  const actualKey = getLiteralKey(getExpectedArgument(node));

  return (
    (matcherName === 'toBeTruthy' && actualKey === 'boolean:true') ||
    (matcherName === 'toBeFalsy' && actualKey === 'boolean:false')
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow tautological literal assertions.',
      recommended: true,
    },
    messages: {
      tautologicalAssertion: 'Tautological assertion: both sides are the same literal value. This test always passes.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isTestFilename(getFilename(context))) {
          return;
        }

        if (hasSameLiteralAssertion(node) || hasAlwaysTrueBooleanAssertion(node)) {
          context.report({
            node,
            messageId: 'tautologicalAssertion',
          });
        }
      },
    };
  },
};
