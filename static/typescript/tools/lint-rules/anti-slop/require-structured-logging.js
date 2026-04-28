"use strict";

const { unwrapExpression } = require("./ast-utils.js");

const DEFAULT_STRUCTURED_LOGGERS = new Set([
  "logger",
  "log",
  "pino",
  "winston",
  "bunyan",
  "log4js",
  "roarr",
]);

const LOG_METHODS = new Set(["trace", "debug", "info", "warn", "warning", "error", "fatal"]);

function getStaticPropertyName(memberExpression) {
  const property = memberExpression.property;

  if (property.type === "Identifier" && !memberExpression.computed) {
    return property.name;
  }

  if (property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }

  return null;
}

function getLoggerCall(node, structuredLoggers) {
  const callee = unwrapExpression(node.callee);

  if (!callee || callee.type !== "MemberExpression") {
    return null;
  }

  const object = unwrapExpression(callee.object);

  if (!object || object.type !== "Identifier" || object.name === "console") {
    return null;
  }

  const methodName = getStaticPropertyName(callee);

  if (!methodName || !LOG_METHODS.has(methodName)) {
    return null;
  }

  return structuredLoggers.has(object.name) ? { objectName: object.name, methodName } : null;
}

function isStringLiteral(node) {
  const expression = unwrapExpression(node);

  return (
    expression &&
    ((expression.type === "Literal" && typeof expression.value === "string") ||
      (expression.type === "TemplateLiteral" && expression.expressions.length === 0))
  );
}

function containsUnstructuredString(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return false;
  }

  if (expression.type === "TemplateLiteral") {
    return expression.expressions.length > 0;
  }

  if (expression.type === "BinaryExpression" && expression.operator === "+") {
    return (
      isStringLiteral(expression.left) ||
      isStringLiteral(expression.right) ||
      containsUnstructuredString(expression.left) ||
      containsUnstructuredString(expression.right)
    );
  }

  return false;
}

function getStructuredLoggerNames(context) {
  const [options = {}] = context.options;
  const configuredLoggers = Array.isArray(options.structuredLoggers)
    ? options.structuredLoggers
    : [];

  return new Set([...DEFAULT_STRUCTURED_LOGGERS, ...configuredLoggers]);
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require structured arguments for known structured logger calls.",
      recommended: true,
    },
    messages: {
      unstructuredLog:
        "Use structured key-value arguments instead of string interpolation in log calls.",
    },
    schema: [
      {
        type: "object",
        properties: {
          structuredLoggers: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const structuredLoggers = getStructuredLoggerNames(context);

    return {
      CallExpression(node) {
        if (!getLoggerCall(node, structuredLoggers)) {
          return;
        }

        if (!node.arguments.some((argument) => containsUnstructuredString(argument))) {
          return;
        }

        context.report({
          node,
          messageId: "unstructuredLog",
        });
      },
    };
  },
};
