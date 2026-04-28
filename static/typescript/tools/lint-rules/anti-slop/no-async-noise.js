"use strict";

const { unwrapExpression } = require("./ast-utils.js");

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

const IGNORED_AST_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"]);

function visitNode(node, state, visitor, rootNode = node) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node !== rootNode && FUNCTION_TYPES.has(node.type)) {
    return;
  }

  if (node.type === "TryStatement") {
    visitor(node, state);
    visitNode(
      node.block,
      {
        ...state,
        tryWithCatchDepth: state.tryWithCatchDepth + (node.handler ? 1 : 0),
      },
      visitor,
      rootNode,
    );
    visitNode(node.handler, state, visitor, rootNode);
    visitNode(node.finalizer, state, visitor, rootNode);
    return;
  }

  visitor(node, state);

  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_AST_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visitNode(item, state, visitor, rootNode);
      }
      continue;
    }

    if (value && typeof value.type === "string") {
      visitNode(value, state, visitor, rootNode);
    }
  }
}

function analyzeAsyncFunction(node) {
  const analysis = {
    hasAwait: false,
    redundantReturnAwaitStatements: [],
  };

  visitNode(node.body, { tryWithCatchDepth: 0 }, (current, state) => {
    if (current.type === "AwaitExpression") {
      analysis.hasAwait = true;
    }

    if (current.type === "ForOfStatement" && current.await) {
      analysis.hasAwait = true;
    }

    if (
      current.type === "ReturnStatement" &&
      state.tryWithCatchDepth === 0 &&
      unwrapExpression(current.argument)?.type === "AwaitExpression"
    ) {
      analysis.redundantReturnAwaitStatements.push(current);
    }
  });

  return analysis;
}

function reportAsyncNoise(context, node) {
  if (!node.async) {
    return;
  }

  const analysis = analyzeAsyncFunction(node);

  for (const statement of analysis.redundantReturnAwaitStatements) {
    context.report({
      node: statement,
      messageId: "redundantReturnAwait",
    });
  }

  if (!analysis.hasAwait) {
    context.report({
      node,
      messageId: "asyncWithoutAwait",
    });
  }
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow redundant async and await patterns.",
      recommended: true,
    },
    messages: {
      redundantReturnAwait:
        "Redundant 'return await'. The async function already wraps the return in a Promise. Remove the await keyword.",
      asyncWithoutAwait:
        "Async function never uses await. Remove the async keyword or add an await expression.",
    },
    schema: [],
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        reportAsyncNoise(context, node);
      },
      FunctionExpression(node) {
        reportAsyncNoise(context, node);
      },
      ArrowFunctionExpression(node) {
        reportAsyncNoise(context, node);
      },
    };
  },
};
