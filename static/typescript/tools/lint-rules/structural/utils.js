'use strict';

const path = require('path');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function getFilename(context) {
  return context.filename || (typeof context.getFilename === 'function' ? context.getFilename() : '');
}

function getBasename(context) {
  return path.basename(getFilename(context));
}

function isNamedFile(context, names) {
  return names.has(getBasename(context));
}

function isSupportedSourceFilename(filename) {
  if (!filename || filename === '<input>') {
    return false;
  }

  return SOURCE_EXTENSIONS.has(path.extname(filename));
}

function getIdentifierName(node) {
  if (!node) {
    return null;
  }

  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') {
    return node.name;
  }

  if (node.type === 'Literal') {
    return String(node.value);
  }

  return null;
}

function addDeclarationToMap(declarationMap, declaration) {
  if (!declaration) {
    return;
  }

  if (
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'ClassDeclaration' ||
    declaration.type === 'TSTypeAliasDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration' ||
    declaration.type === 'TSEnumDeclaration'
  ) {
    const name = getIdentifierName(declaration.id);
    if (name) {
      declarationMap.set(name, {
        name,
        nameNode: declaration.id,
        declaration,
        declarator: null,
      });
    }
    return;
  }

  if (declaration.type === 'VariableDeclaration') {
    for (const declarator of declaration.declarations) {
      const name = getIdentifierName(declarator.id);
      if (name) {
        declarationMap.set(name, {
          name,
          nameNode: declarator.id,
          declaration,
          declarator,
        });
      }
    }
  }
}

function createTopLevelDeclarationMap(programNode) {
  const declarationMap = new Map();

  for (const statement of programNode.body) {
    const declaration = statement.type === 'ExportNamedDeclaration'
      ? statement.declaration
      : statement;
    addDeclarationToMap(declarationMap, declaration);
  }

  return declarationMap;
}

function addDefinitionsFromDeclaration(definitions, declaration, exportNode, seen) {
  if (!declaration) {
    return;
  }

  if (
    declaration.type === 'FunctionDeclaration' ||
    declaration.type === 'ClassDeclaration' ||
    declaration.type === 'TSTypeAliasDeclaration' ||
    declaration.type === 'TSInterfaceDeclaration' ||
    declaration.type === 'TSEnumDeclaration'
  ) {
    const name = getIdentifierName(declaration.id);
    if (name && !seen.has(name)) {
      seen.add(name);
      definitions.push({
        name,
        nameNode: declaration.id || declaration,
        declaration,
        declarator: null,
        exportNode,
      });
    }
    return;
  }

  if (declaration.type === 'VariableDeclaration') {
    for (const declarator of declaration.declarations) {
      const name = getIdentifierName(declarator.id);
      if (name && !seen.has(name)) {
        seen.add(name);
        definitions.push({
          name,
          nameNode: declarator.id,
          declaration,
          declarator,
          exportNode,
        });
      }
    }
  }
}

function getSpecifierLocalName(specifier) {
  if (!specifier) {
    return null;
  }

  return getIdentifierName(specifier.local) || getIdentifierName(specifier.exported);
}

function getSpecifierExportedName(specifier) {
  if (!specifier) {
    return null;
  }

  return getIdentifierName(specifier.exported) || getSpecifierLocalName(specifier);
}

function getExportedDefinitions(programNode) {
  const declarationMap = createTopLevelDeclarationMap(programNode);
  const definitions = [];
  const seen = new Set();

  for (const statement of programNode.body) {
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.source) {
        continue;
      }

      if (statement.declaration) {
        addDefinitionsFromDeclaration(definitions, statement.declaration, statement, seen);
        continue;
      }

      for (const specifier of statement.specifiers || []) {
        const localName = getSpecifierLocalName(specifier);
        const exportedName = getSpecifierExportedName(specifier);
        const localDefinition = declarationMap.get(localName);
        if (localDefinition && exportedName && !seen.has(exportedName)) {
          seen.add(exportedName);
          definitions.push({
            ...localDefinition,
            localName: localDefinition.name,
            name: exportedName,
            nameNode: specifier.exported || localDefinition.nameNode,
            exportNode: statement,
          });
        }
      }
      continue;
    }

    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration;
      if (!declaration) {
        continue;
      }

      if (declaration.type === 'Identifier') {
        const localDefinition = declarationMap.get(declaration.name);
        if (localDefinition && !seen.has(localDefinition.name)) {
          seen.add(localDefinition.name);
          definitions.push({ ...localDefinition, exportNode: statement });
        }
        continue;
      }

      addDefinitionsFromDeclaration(definitions, declaration, statement, seen);
    }
  }

  return definitions;
}

function normalizeSymbolName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function unwrapExpression(node) {
  let current = node;

  while (
    current &&
    (
      current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression'
    )
  ) {
    current = current.expression;
  }

  return current;
}

function isConstAssertion(node) {
  return Boolean(
    node &&
    node.type === 'TSAsExpression' &&
    node.typeAnnotation &&
    node.typeAnnotation.type === 'TSTypeReference' &&
    getIdentifierName(node.typeAnnotation.typeName) === 'const'
  );
}

module.exports = {
  getBasename,
  getFilename,
  getIdentifierName,
  getExportedDefinitions,
  isConstAssertion,
  isNamedFile,
  isSupportedSourceFilename,
  normalizeSymbolName,
  unwrapExpression,
};
