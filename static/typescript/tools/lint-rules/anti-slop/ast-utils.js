'use strict';

const CONSOLE_LOG_METHODS = new Set(['log', 'error', 'warn', 'info', 'debug']);
const LOGGER_OBJECT_NAMES = new Set(['logger', 'log']);

function getStaticPropertyName(memberExpression) {
  const property = memberExpression.property;

  if (property.type === 'Identifier' && !memberExpression.computed) {
    return property.name;
  }

  if (
    property.type === 'Literal' &&
    typeof property.value === 'string'
  ) {
    return property.value;
  }

  return null;
}

function unwrapExpression(node) {
  let current = node;

  while (
    current &&
    ['ChainExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(current.type)
  ) {
    current = current.expression;
  }

  return current;
}

function isLoggingCall(node) {
  const expression = unwrapExpression(node);

  if (!expression || expression.type !== 'CallExpression') {
    return false;
  }

  const callee = unwrapExpression(expression.callee);

  if (!callee || callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') {
    return false;
  }

  const objectName = callee.object.name;
  const propertyName = getStaticPropertyName(callee);

  if (!propertyName) {
    return false;
  }

  if (objectName === 'console') {
    return CONSOLE_LOG_METHODS.has(propertyName);
  }

  return LOGGER_OBJECT_NAMES.has(objectName);
}

function isLoggingStatement(statement) {
  return (
    statement.type === 'ExpressionStatement' &&
    isLoggingCall(statement.expression)
  );
}

module.exports = {
  isLoggingCall,
  isLoggingStatement,
  unwrapExpression,
};
