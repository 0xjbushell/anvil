'use strict';

const { getExportedDefinitions, getIdentifierName, isNamedFile } = require('./utils.js');

const ERRORS_FILES = new Set(['errors.ts', 'errors.tsx']);

function isErrorLikeName(name) {
  return /Error$/.test(name || '');
}

function isErrorSuperClass(superClass) {
  if (!superClass) {
    return false;
  }

  if (superClass.type === 'Identifier') {
    return isErrorLikeName(superClass.name);
  }

  if (superClass.type === 'MemberExpression') {
    return isErrorLikeName(getIdentifierName(superClass.property));
  }

  return false;
}

function isErrorDefinition(definition) {
  const declaration = definition.declaration;
  const hasErrorLikeName = (
    isErrorLikeName(definition.name) ||
    isErrorLikeName(definition.localName)
  );

  if (declaration.type === 'ClassDeclaration') {
    return hasErrorLikeName || isErrorSuperClass(declaration.superClass);
  }

  if (
    declaration.type === 'TSTypeAliasDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration'
  ) {
    return hasErrorLikeName;
  }

  return false;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require exported error declarations to live in errors.ts.',
      recommended: true,
    },
    messages: {
      errorOutsideErrorsFile: "Exported error class '{{ name }}' should be in errors.ts.",
      nonErrorInErrorsFile: "Non-error declaration '{{ name }}' should not be in errors.ts. Move it to the appropriate file.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const inErrorsFile = isNamedFile(context, ERRORS_FILES);

        for (const definition of getExportedDefinitions(node)) {
          const isError = isErrorDefinition(definition);

          if (!inErrorsFile && isError) {
            context.report({
              node: definition.nameNode,
              messageId: 'errorOutsideErrorsFile',
              data: { name: definition.name },
            });
            continue;
          }

          if (inErrorsFile && !isError) {
            context.report({
              node: definition.nameNode,
              messageId: 'nonErrorInErrorsFile',
              data: { name: definition.name },
            });
          }
        }
      },
    };
  },
};
