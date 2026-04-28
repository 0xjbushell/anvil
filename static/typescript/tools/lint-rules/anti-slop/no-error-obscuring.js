"use strict";

const { unwrapExpression } = require("./ast-utils.js");

const IGNORED_AST_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"]);

function collectPatternIdentifiers(pattern, names = new Set()) {
  if (!pattern) {
    return names;
  }

  if (pattern.type === "Identifier") {
    names.add(pattern.name);
    return names;
  }

  if (pattern.type === "RestElement") {
    return collectPatternIdentifiers(pattern.argument, names);
  }

  if (pattern.type === "AssignmentPattern") {
    return collectPatternIdentifiers(pattern.left, names);
  }

  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) {
      collectPatternIdentifiers(element, names);
    }
    return names;
  }

  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "Property") {
        collectPatternIdentifiers(property.value, names);
      } else {
        collectPatternIdentifiers(property.argument, names);
      }
    }
  }

  return names;
}

function visitNode(node, visitor) {
  if (!node || typeof node !== "object") {
    return false;
  }

  if (visitor(node)) {
    return true;
  }

  if (node.type === "MemberExpression") {
    return visitNode(node.object, visitor) || (node.computed && visitNode(node.property, visitor));
  }

  if (node.type === "Property") {
    return (node.computed && visitNode(node.key, visitor)) || visitNode(node.value, visitor);
  }

  if (node.type === "PropertyDefinition") {
    return (node.computed && visitNode(node.key, visitor)) || visitNode(node.value, visitor);
  }

  if (node.type === "MethodDefinition") {
    return (node.computed && visitNode(node.key, visitor)) || visitNode(node.value, visitor);
  }

  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_AST_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (visitNode(item, visitor)) {
          return true;
        }
      }
      continue;
    }

    if (value && typeof value.type === "string" && visitNode(value, visitor)) {
      return true;
    }
  }

  return false;
}

function containsCaughtError(node, caughtErrorNames) {
  if (caughtErrorNames.size === 0) {
    return false;
  }

  return visitNode(
    node,
    (current) => current.type === "Identifier" && caughtErrorNames.has(current.name),
  );
}

function containsCallWithCaughtErrorArgument(node, caughtErrorNames) {
  return visitNode(node, (current) => {
    if (current.type !== "CallExpression" && current.type !== "NewExpression") {
      return false;
    }

    return current.arguments.some((argument) => containsCaughtError(argument, caughtErrorNames));
  });
}

function isMeaningfulReferenceStatement(statement, caughtErrorNames) {
  if (caughtErrorNames.size === 0) {
    return false;
  }

  if (
    statement.type === "ThrowStatement" &&
    containsCaughtError(statement.argument, caughtErrorNames)
  ) {
    return true;
  }

  if (
    statement.type === "ReturnStatement" &&
    !isDefaultReturnValue(statement.argument) &&
    containsCaughtError(statement.argument, caughtErrorNames)
  ) {
    return true;
  }

  if (statement.type === "IfStatement") {
    return false;
  }

  return containsCallWithCaughtErrorArgument(statement, caughtErrorNames);
}

function hasPriorMeaningfulErrorReference(statements, returnIndex, caughtErrorNames) {
  return statements
    .slice(0, returnIndex)
    .some((statement) => isMeaningfulReferenceStatement(statement, caughtErrorNames));
}

function isDefaultReturnValue(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return true;
  }

  if (expression.type === "Identifier") {
    return expression.name === "undefined";
  }

  if (expression.type === "Literal") {
    return (
      expression.value === null ||
      expression.value === false ||
      expression.value === 0 ||
      expression.value === ""
    );
  }

  if (expression.type === "ArrayExpression") {
    return expression.elements.length === 0;
  }

  if (expression.type === "ObjectExpression") {
    return expression.properties.length === 0;
  }

  if (expression.type === "UnaryExpression" && expression.operator === "void") {
    return true;
  }

  return false;
}

function isGenericErrorThrow(statement, caughtErrorNames) {
  const argument = unwrapExpression(statement.argument);

  return (
    argument &&
    argument.type === "NewExpression" &&
    argument.callee.type === "Identifier" &&
    argument.callee.name === "Error" &&
    !containsCaughtError(argument, caughtErrorNames)
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow catch blocks that discard original error context.",
      recommended: true,
    },
    messages: {
      defaultReturn:
        "Error context is discarded by returning a default value. Wrap the original error or propagate it.",
      genericThrow:
        "Error context is discarded by throwing a generic error. Wrap the original error with { cause: <error> } or use a custom error type.",
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        const caughtErrorNames = collectPatternIdentifiers(node.param);

        for (const [index, statement] of node.body.body.entries()) {
          if (
            statement.type === "ReturnStatement" &&
            isDefaultReturnValue(statement.argument) &&
            !hasPriorMeaningfulErrorReference(node.body.body, index, caughtErrorNames)
          ) {
            context.report({
              node: statement,
              messageId: "defaultReturn",
            });
          }

          if (
            statement.type === "ThrowStatement" &&
            isGenericErrorThrow(statement, caughtErrorNames)
          ) {
            context.report({
              node: statement,
              messageId: "genericThrow",
            });
          }
        }
      },
    };
  },
};
