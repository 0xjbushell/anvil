"use strict";

const path = require("path");

const { getFilename } = require("./utils.js");

const INDEX_FILE_PATTERN = /^index\.(?:ts|tsx|js|mjs)$/;

function isReExport(statement) {
  return (
    statement.type === "ExportAllDeclaration" ||
    (statement.type === "ExportNamedDeclaration" && Boolean(statement.source))
  );
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow index files dominated by re-exports.",
      recommended: true,
    },
    messages: {
      barrelDensity:
        "Barrel file is dominated by re-exports ({{ reExports }}/{{ total }} statements). Reduce re-exports or move logic into a non-index file.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        if (!INDEX_FILE_PATTERN.test(path.basename(getFilename(context)))) {
          return;
        }

        const total = node.body.length;
        if (total === 0) {
          return;
        }

        const reExports = node.body.filter(isReExport).length;
        if (reExports >= 3 && reExports / total > 0.8) {
          context.report({
            node,
            messageId: "barrelDensity",
            data: {
              reExports,
              total,
            },
          });
        }
      },
    };
  },
};
