package notautological

import (
	"go/ast"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "notautological", Doc: "reports tautological assertions", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if ident, ok := sel.X.(*ast.Ident); ok && (ident.Name == "assert" || ident.Name == "require") {
				switch sel.Sel.Name {
				case "Equal", "EqualValues", "Exactly":
					if len(call.Args) >= 3 && sameLiteral(call.Args[1], call.Args[2]) {
						pass.Reportf(call.Pos(), "assertion compares identical literal values")
					}
				case "True":
					if len(call.Args) >= 2 && literal(call.Args[1], "true") {
						pass.Reportf(call.Pos(), "assertion is tautologically true")
					}
				case "False":
					if len(call.Args) >= 2 && literal(call.Args[1], "false") {
						pass.Reportf(call.Pos(), "assertion is tautologically false")
					}
				case "Nil":
					if len(call.Args) >= 2 && literal(call.Args[1], "nil") {
						pass.Reportf(call.Pos(), "nil assertion on nil is tautological")
					}
				}
			}
			return true
		})
	}
	return nil, nil
}

func sameLiteral(a, b ast.Expr) bool {
	av, aok := analyzerutil.LiteralValue(a)
	bv, bok := analyzerutil.LiteralValue(b)
	return aok && bok && av == bv
}
func literal(expr ast.Expr, want string) bool {
	got, ok := analyzerutil.LiteralValue(expr)
	return ok && got == want
}
