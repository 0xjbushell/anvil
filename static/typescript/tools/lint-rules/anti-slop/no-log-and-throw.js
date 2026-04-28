"use strict";

const { isLoggingStatement, unwrapExpression } = require("./ast-utils.js");

const IGNORED_AST_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"]);
const NESTED_SCOPE_TYPES = new Set([
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

function getCalleeName(callee) {
  const expression = unwrapExpression(callee);

  if (!expression) {
    return null;
  }

  if (expression.type === "Identifier") {
    return expression.name;
  }

  if (expression.type !== "MemberExpression") {
    return null;
  }

  const property = expression.property;

  if (property.type === "Identifier" && !expression.computed) {
    return property.name;
  }

  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }

  return null;
}

function isErrorLikeName(name) {
  return name === "Error" || /Error$/.test(name) || /^(err|error)$/i.test(name);
}

function isReturnedError(statement) {
  if (statement.type !== "ReturnStatement") {
    return false;
  }

  const argument = unwrapExpression(statement.argument);

  if (!argument) {
    return false;
  }

  if (argument.type === "Identifier") {
    return isErrorLikeName(argument.name);
  }

  if (argument.type === "NewExpression" || argument.type === "CallExpression") {
    const calleeName = getCalleeName(argument.callee);
    return Boolean(calleeName && isErrorLikeName(calleeName));
  }

  return false;
}

function hasDirectErrorExit(blockNode) {
  return blockNode.body.some(
    (statement) => statement.type === "ThrowStatement" || isReturnedError(statement),
  );
}

function collectLogCalls(node, logCalls = []) {
  if (!node || typeof node !== "object") {
    return logCalls;
  }

  if (NESTED_SCOPE_TYPES.has(node.type)) {
    return logCalls;
  }

  if (node.type === "ExpressionStatement" && isLoggingStatement(node)) {
    logCalls.push(node.expression);
    return logCalls;
  }

  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_AST_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectLogCalls(item, logCalls);
      }
      continue;
    }

    if (value && typeof value.type === "string") {
      collectLogCalls(value, logCalls);
    }
  }

  return logCalls;
}

function reportBlockLogAndThrow(context, blockNode) {
  if (!hasDirectErrorExit(blockNode)) {
    return;
  }

  for (const logCall of collectLogCalls(blockNode)) {
    context.report({
      node: logCall,
      messageId: "logAndThrow",
    });
  }
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow logging and throwing in the same block.",
      recommended: true,
    },
    messages: {
      logAndThrow:
        "Logging and throwing in the same block creates duplicate error reports. Choose one.",
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        reportBlockLogAndThrow(context, node.body);
      },
      IfStatement(node) {
        if (node.consequent.type === "BlockStatement") {
          reportBlockLogAndThrow(context, node.consequent);
        }

        if (node.alternate && node.alternate.type === "BlockStatement") {
          reportBlockLogAndThrow(context, node.alternate);
        }
      },
    };
  },
};
