"use strict";

const {
  getExportedDefinitions,
  isConstAssertion,
  isNamedFile,
  unwrapExpression,
} = require("./utils.js");

const CONSTANTS_FILES = new Set(["constants.ts", "constants.tsx"]);

function isUppercaseIdentifierName(name) {
  return /^[A-Z]/.test(name || "");
}

function isStaticMemberProperty(property) {
  return (
    property.type === "Identifier" ||
    (property.type === "Literal" && typeof property.value === "string")
  );
}

function isEnumLikeMemberExpression(node) {
  if (node.type !== "MemberExpression" || !isStaticMemberProperty(node.property)) {
    return false;
  }

  if (node.object.type === "Identifier") {
    return isUppercaseIdentifierName(node.object.name);
  }

  return node.object.type === "MemberExpression" && isEnumLikeMemberExpression(node.object);
}

function isLiteralConstant(node) {
  const expression = unwrapExpression(node);

  if (!expression) {
    return false;
  }

  if (expression.type === "Literal") {
    return true;
  }

  if (expression.type === "TemplateLiteral") {
    return expression.expressions.length === 0;
  }

  if (expression.type === "MemberExpression") {
    return isEnumLikeMemberExpression(expression);
  }

  if (expression.type === "UnaryExpression") {
    return isLiteralConstant(expression.argument);
  }

  if (expression.type === "ArrayExpression") {
    return expression.elements.every((element) => element && isLiteralConstant(element));
  }

  if (expression.type === "ObjectExpression") {
    return expression.properties.every(
      (property) =>
        property.type === "Property" &&
        (!property.computed || isLiteralConstant(property.key)) &&
        isLiteralConstant(property.value),
    );
  }

  return false;
}

function isCompileTimeConstant(node) {
  return isConstAssertion(node) || isLiteralConstant(node);
}

function isConstantDefinition(definition) {
  return Boolean(
    definition.declaration.type === "VariableDeclaration" &&
    definition.declaration.kind === "const" &&
    definition.declarator &&
    isCompileTimeConstant(definition.declarator.init),
  );
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require exported compile-time constants to live in constants.ts.",
      recommended: true,
    },
    messages: {
      constantOutsideConstantsFile: "Exported constant '{{ name }}' should be in constants.ts.",
      nonConstantInConstantsFile:
        "Non-constant declaration '{{ name }}' should not be in constants.ts. Move it to the appropriate file.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const inConstantsFile = isNamedFile(context, CONSTANTS_FILES);

        for (const definition of getExportedDefinitions(node)) {
          const isConstant = isConstantDefinition(definition);

          if (!inConstantsFile && isConstant) {
            context.report({
              node: definition.nameNode,
              messageId: "constantOutsideConstantsFile",
              data: { name: definition.name },
            });
            continue;
          }

          if (inConstantsFile && !isConstant) {
            context.report({
              node: definition.nameNode,
              messageId: "nonConstantInConstantsFile",
              data: { name: definition.name },
            });
          }
        }
      },
    };
  },
};
