'use strict';

const { unwrapExpression } = require('./ast-utils.js');

function getIdentifierParameterNames(params) {
  const names = [];

  for (const param of params) {
    const expression = unwrapExpression(param);

    if (!expression || expression.type !== 'Identifier') {
      return null;
    }

    names.push(expression.name);
  }

  return names;
}

function getReturnedCall(node) {
  if (node.type === 'ArrowFunctionExpression') {
    const expression = unwrapExpression(node.body);

    if (expression && expression.type === 'CallExpression') {
      return expression;
    }
  }

  if (!node.body || node.body.type !== 'BlockStatement' || node.body.body.length !== 1) {
    return null;
  }

  const [statement] = node.body.body;

  if (statement.type !== 'ReturnStatement') {
    return null;
  }

  const argument = unwrapExpression(statement.argument);

  return argument && argument.type === 'CallExpression' ? argument : null;
}

function isSameIdentifierArgumentList(args, parameterNames) {
  return (
    args.length === parameterNames.length &&
    args.every((argument, index) => {
      const expression = unwrapExpression(argument);
      return (
        expression &&
        expression.type === 'Identifier' &&
        expression.name === parameterNames[index]
      );
    })
  );
}

function reportPassThroughWrapper(context, node) {
  const parameterNames = getIdentifierParameterNames(node.params);

  if (!parameterNames) {
    return;
  }

  const call = getReturnedCall(node);

  if (!call || !isSameIdentifierArgumentList(call.arguments, parameterNames)) {
    return;
  }

  context.report({
    node,
    messageId: 'passThroughWrapper',
  });
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow functions that only pass their arguments to another function.',
      recommended: true,
    },
    messages: {
      passThroughWrapper: 'Function is a pass-through wrapper. Call the inner function directly or add meaningful logic.',
    },
    schema: [],
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        reportPassThroughWrapper(context, node);
      },
      FunctionExpression(node) {
        reportPassThroughWrapper(context, node);
      },
      ArrowFunctionExpression(node) {
        reportPassThroughWrapper(context, node);
      },
    };
  },
};
