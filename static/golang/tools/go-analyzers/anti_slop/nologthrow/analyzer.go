package nologthrow

import (
	"go/ast"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "nologthrow", Doc: "reports logging an error and returning it from the same block", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			stmt, ok := n.(*ast.IfStmt)
			if !ok || stmt.Body == nil || !analyzerutil.IsErrorNilCheck(pass, stmt.Cond) {
				return true
			}
			logged := false
			returned := false
			ast.Inspect(stmt.Body, func(child ast.Node) bool {
				switch node := child.(type) {
				case *ast.CallExpr:
					if analyzerutil.IsWarnErrorFatalLogCall(pass, node) {
						logged = true
					}
				case *ast.ReturnStmt:
					if analyzerutil.ReturnHasError(pass, node) {
						returned = true
					}
				}
				return true
			})
			if logged && returned {
				pass.Reportf(stmt.Pos(), "error is logged and returned; choose one reporting boundary")
			}
			return true
		})
	}
	return nil, nil
}
