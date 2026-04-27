'use strict';

const path = require('path');

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
]);
const IGNORED_AST_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_SUFFIX_PATTERN = /^(?<name>.+?)(?:\.test|\.spec)(?<extension>\.[cm]?[jt]sx?)$/;

function getFilename(context) {
  return context.filename || (typeof context.getFilename === 'function' ? context.getFilename() : '');
}

function isTestFilename(filename) {
  return TEST_FILE_PATTERN.test(path.basename(filename || ''));
}

function getSourceCode(context) {
  return context.sourceCode || context.getSourceCode();
}

function getMemberPropertyName(memberExpressionNode) {
  const { computed, property } = memberExpressionNode;

  switch (property.type) {
    case 'Identifier':
      return computed ? null : property.name;
    case 'Literal':
      return typeof property.value === 'string' ? property.value : null;
    default:
      return null;
  }
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

function visitNode(node, visitor, options = {}) {
  const { rootNode = node, skipNestedFunctions = false } = options;

  if (!node || typeof node !== 'object') {
    return;
  }

  if (node !== rootNode && skipNestedFunctions && FUNCTION_TYPES.has(node.type)) {
    return;
  }

  visitor(node);

  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_AST_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visitNode(item, visitor, { rootNode, skipNestedFunctions });
      }
      continue;
    }

    if (value && typeof value.type === 'string') {
      visitNode(value, visitor, { rootNode, skipNestedFunctions });
    }
  }
}

function isIdentifierNamed(node, names) {
  const expression = unwrapExpression(node);
  return expression?.type === 'Identifier' && names.has(expression.name);
}

function isAssertCall(node) {
  const expression = unwrapExpression(node);

  if (!expression || expression.type !== 'CallExpression') {
    return false;
  }

  const callee = unwrapExpression(expression.callee);

  if (isIdentifierNamed(callee, new Set(['assert']))) {
    return true;
  }

  return (
    callee?.type === 'MemberExpression' &&
    isIdentifierNamed(callee.object, new Set(['assert']))
  );
}

function isExpectCall(node) {
  const expression = unwrapExpression(node);
  return (
    expression?.type === 'CallExpression' &&
    isIdentifierNamed(expression.callee, new Set(['expect']))
  );
}

function hasExpectRoot(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return false;
  }

  if (isExpectCall(expression)) {
    return true;
  }

  if (expression.type === 'MemberExpression') {
    return hasExpectRoot(expression.object);
  }

  if (expression.type === 'CallExpression') {
    return hasExpectRoot(expression.callee);
  }

  return false;
}

function getExpectMatcherName(node) {
  const expression = unwrapExpression(node);

  if (!expression || expression.type !== 'CallExpression') {
    return null;
  }

  const callee = unwrapExpression(expression.callee);
  if (callee?.type !== 'MemberExpression' || !hasExpectRoot(callee.object)) {
    return null;
  }

  return getMemberPropertyName(callee);
}

function hasExpectChainProperty(node, propertyName) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return false;
  }

  if (expression.type === 'MemberExpression') {
    return (
      getMemberPropertyName(expression) === propertyName &&
      hasExpectRoot(expression.object)
    ) || hasExpectChainProperty(expression.object, propertyName);
  }

  if (expression.type === 'CallExpression') {
    return hasExpectChainProperty(expression.callee, propertyName);
  }

  return false;
}

function hasShouldChain(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return false;
  }

  if (expression.type === 'MemberExpression') {
    return getMemberPropertyName(expression) === 'should' || hasShouldChain(expression.object);
  }

  if (expression.type === 'CallExpression') {
    return hasShouldChain(expression.callee);
  }

  return false;
}

function isAssertionCall(node) {
  const expression = unwrapExpression(node);

  if (!expression || expression.type !== 'CallExpression') {
    return false;
  }

  return isExpectCall(expression) || isAssertCall(expression) || hasShouldChain(expression.callee);
}

function isTestBaseMember(node, memberNames) {
  const expression = unwrapExpression(node);

  return (
    expression?.type === 'MemberExpression' &&
    isIdentifierNamed(expression.object, new Set(['it', 'test'])) &&
    memberNames.has(getMemberPropertyName(expression))
  );
}

function isRunnableTestCall(node) {
  const callee = unwrapExpression(node.callee);

  if (isIdentifierNamed(callee, new Set(['it', 'test']))) {
    return true;
  }

  if (isTestBaseMember(callee, new Set(['only']))) {
    return true;
  }

  return callee?.type === 'CallExpression' && isTestBaseMember(callee.callee, new Set(['each']));
}

function getFunctionArgument(args) {
  return args.find((argument) => {
    const expression = unwrapExpression(argument);
    return expression?.type === 'ArrowFunctionExpression' || expression?.type === 'FunctionExpression';
  }) || null;
}

function getFirstStringArgument(args) {
  const [firstArgument] = args;
  const expression = unwrapExpression(firstArgument);

  if (!expression) {
    return '<unknown>';
  }

  if (expression.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value;
  }

  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis.map((quasi) => quasi.value.cooked || '').join('');
  }

  return '<unknown>';
}

function isSkippedTestCall(node) {
  const callee = unwrapExpression(node.callee);

  if (isIdentifierNamed(callee, new Set(['xit', 'xtest', 'xdescribe']))) {
    return true;
  }

  return (
    callee?.type === 'MemberExpression' &&
    getMemberPropertyName(callee) === 'skip' &&
    isIdentifierNamed(callee.object, new Set(['it', 'test', 'describe']))
  );
}

function getSourceFileCandidates(filename) {
  const parsed = path.parse(filename);
  const match = parsed.base.match(TEST_SUFFIX_PATTERN);

  if (!match?.groups) {
    return [];
  }

  const sourceBasename = `${match.groups.name}${match.groups.extension}`;
  const candidates = [path.join(parsed.dir, sourceBasename)];
  const segments = parsed.dir.split(path.sep);
  const testsIndex = segments.lastIndexOf('tests');

  if (testsIndex >= 0) {
    const root = segments.slice(0, testsIndex).join(path.sep) || path.sep;
    const mirroredSegments = segments.slice(testsIndex + 1);
    candidates.push(path.join(root, 'src', ...mirroredSegments, sourceBasename));
  }

  if (segments.includes('__tests__')) {
    candidates.push(path.join(parsed.dir, '..', sourceBasename));
  }

  return candidates.map((candidate) => path.normalize(candidate));
}

module.exports = {
  getExpectMatcherName,
  getFilename,
  getFirstStringArgument,
  getFunctionArgument,
  getSourceCode,
  getSourceFileCandidates,
  getMemberPropertyName,
  hasExpectChainProperty,
  hasExpectRoot,
  isAssertCall,
  isAssertionCall,
  isRunnableTestCall,
  isSkippedTestCall,
  isTestFilename,
  unwrapExpression,
  visitNode,
};
