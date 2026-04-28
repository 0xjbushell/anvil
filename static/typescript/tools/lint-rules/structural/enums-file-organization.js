"use strict";

const { getExportedDefinitions, isNamedFile } = require("./utils.js");

const ENUMS_FILES = new Set(["enums.ts", "enums.tsx"]);

function isEnumDefinition(definition) {
  return definition.declaration.type === "TSEnumDeclaration";
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require exported TypeScript enums to live in enums.ts.",
      recommended: true,
    },
    messages: {
      enumOutsideEnumsFile: "Exported enum '{{ name }}' should be in enums.ts.",
      nonEnumInEnumsFile:
        "Non-enum declaration '{{ name }}' should not be in enums.ts. Move it to the appropriate file.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const inEnumsFile = isNamedFile(context, ENUMS_FILES);

        for (const definition of getExportedDefinitions(node)) {
          const isEnum = isEnumDefinition(definition);

          if (!inEnumsFile && isEnum) {
            context.report({
              node: definition.nameNode,
              messageId: "enumOutsideEnumsFile",
              data: { name: definition.name },
            });
            continue;
          }

          if (inEnumsFile && !isEnum) {
            context.report({
              node: definition.nameNode,
              messageId: "nonEnumInEnumsFile",
              data: { name: definition.name },
            });
          }
        }
      },
    };
  },
};
