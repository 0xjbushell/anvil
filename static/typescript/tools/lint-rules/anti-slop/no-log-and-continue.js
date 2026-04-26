'use strict';

const { isLoggingStatement } = require('./ast-utils.js');

function analyzeStatement(statement) {
  if (statement.type === 'EmptyStatement') {
    return { hasLog: false, onlyLogLike: true };
  }

  if (isLoggingStatement(statement)) {
    return { hasLog: true, onlyLogLike: true };
  }

  if (statement.type === 'BlockStatement') {
    return analyzeStatements(statement.body);
  }

  if (statement.type === 'IfStatement') {
    const consequent = analyzeStatement(statement.consequent);
    const alternate = statement.alternate
      ? analyzeStatement(statement.alternate)
      : { hasLog: false, onlyLogLike: true };

    return {
      hasLog: consequent.hasLog || alternate.hasLog,
      onlyLogLike: consequent.onlyLogLike && alternate.onlyLogLike,
    };
  }

  return { hasLog: false, onlyLogLike: false };
}

function analyzeStatements(statements) {
  return statements.reduce(
    (result, statement) => {
      const current = analyzeStatement(statement);

      return {
        hasLog: result.hasLog || current.hasLog,
        onlyLogLike: result.onlyLogLike && current.onlyLogLike,
      };
    },
    { hasLog: false, onlyLogLike: true },
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow catch blocks that only log an error and continue.',
      recommended: true,
    },
    messages: {
      logAndContinue: 'Catch block only logs the error without handling it. Re-throw, return an error, or add recovery logic.',
    },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        const analysis = analyzeStatements(node.body.body);

        if (!analysis.hasLog || !analysis.onlyLogLike) {
          return;
        }

        context.report({
          node,
          messageId: 'logAndContinue',
        });
      },
    };
  },
};
