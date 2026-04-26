'use strict';

const { getExportedDefinitions } = require('./utils.js');

function isFunctionExpressionDefinition(definition) {
  return Boolean(
    definition.declaration.type === 'VariableDeclaration' &&
    definition.declarator &&
    (
      definition.declarator.init?.type === 'ArrowFunctionExpression' ||
      definition.declarator.init?.type === 'FunctionExpression'
    )
  );
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require exported functions to use function declarations instead of exported function expressions.',
      recommended: true,
    },
    messages: {
      exportedFunctionExpression: "Use 'export function {{ name }}()' instead of exporting '{{ kind }} {{ name }} = ...'. Function declarations are hoisted and more readable.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        for (const definition of getExportedDefinitions(node)) {
          if (!isFunctionExpressionDefinition(definition)) {
            continue;
          }

          context.report({
            node: definition.nameNode,
            messageId: 'exportedFunctionExpression',
            data: {
              name: definition.name,
              kind: definition.declaration.kind,
            },
          });
        }
      },
    };
  },
};
