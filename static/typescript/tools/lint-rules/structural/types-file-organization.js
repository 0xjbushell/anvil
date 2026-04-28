"use strict";

const { getExportedDefinitions, isNamedFile } = require("./utils.js");

const TYPES_FILES = new Set(["types.ts", "types.tsx"]);

function isTypeDefinition(definition) {
  return (
    definition.declaration.type === "TSTypeAliasDeclaration" ||
    definition.declaration.type === "TSInterfaceDeclaration"
  );
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require exported TypeScript types and interfaces to live in types.ts.",
      recommended: true,
    },
    messages: {
      typeOutsideTypesFile: "Exported type '{{ name }}' should be in types.ts.",
      nonTypeInTypesFile:
        "Non-type declaration '{{ name }}' should not be in types.ts. Move it to the appropriate file.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const inTypesFile = isNamedFile(context, TYPES_FILES);

        for (const definition of getExportedDefinitions(node)) {
          if (!inTypesFile && isTypeDefinition(definition)) {
            context.report({
              node: definition.nameNode,
              messageId: "typeOutsideTypesFile",
              data: { name: definition.name },
            });
            continue;
          }

          if (inTypesFile && !isTypeDefinition(definition)) {
            context.report({
              node: definition.nameNode,
              messageId: "nonTypeInTypesFile",
              data: { name: definition.name },
            });
          }
        }
      },
    };
  },
};
