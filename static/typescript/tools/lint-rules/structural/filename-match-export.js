"use strict";

const path = require("path");

const {
  getExportedDefinitions,
  getFilename,
  isSupportedSourceFilename,
  normalizeSymbolName,
} = require("./utils.js");

const EXEMPT_BASENAMES = new Set(["index", "types", "errors", "constants", "enums"]);

function getFileStem(filename) {
  return path.parse(filename).name;
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require a single primary export to match its filename.",
      recommended: true,
    },
    messages: {
      filenameMismatch:
        "Primary export '{{ exportName }}' does not match filename '{{ filename }}'. Rename the file or the export.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        const filename = getFilename(context);
        if (!isSupportedSourceFilename(filename)) {
          return;
        }

        const fileStem = getFileStem(path.basename(filename));
        if (EXEMPT_BASENAMES.has(fileStem)) {
          return;
        }

        const exportedDefinitions = getExportedDefinitions(node);
        if (exportedDefinitions.length !== 1) {
          return;
        }

        const [primaryExport] = exportedDefinitions;
        if (normalizeSymbolName(primaryExport.name) !== normalizeSymbolName(fileStem)) {
          context.report({
            node: primaryExport.nameNode,
            messageId: "filenameMismatch",
            data: {
              exportName: primaryExport.name,
              filename: fileStem,
            },
          });
        }
      },
    };
  },
};
