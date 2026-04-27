package nologcontinue

import (
	"go/ast"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "nologcontinue", Doc: "reports error checks that only log and then continue", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			stmt, ok := n.(*ast.IfStmt)
			if !ok || stmt.Body == nil || !analyzerutil.IsErrorNilCheck(pass, stmt.Cond) {
				return true
			}
			if len(stmt.Body.List) == 0 {
				return true
			}
			for _, child := range stmt.Body.List {
				exprStmt, ok := child.(*ast.ExprStmt)
				if !ok || !analyzerutil.IsExprLogCall(pass, exprStmt.X) {
					return true
				}
			}
			pass.Reportf(stmt.Pos(), "error check only logs and continues; handle or return the error")
			return true
		})
	}
	return nil, nil
}
