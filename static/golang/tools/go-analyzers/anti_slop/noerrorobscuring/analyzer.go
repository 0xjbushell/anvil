package noerrorobscuring

import (
	"go/ast"
	"go/types"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "noerrorobscuring", Doc: "reports error paths that discard the checked error", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok || fn.Body == nil || !funcReturnsError(pass, fn) {
				return true
			}
			ast.Inspect(fn.Body, func(child ast.Node) bool {
				stmt, ok := child.(*ast.IfStmt)
				if !ok || stmt.Body == nil || !analyzerutil.IsErrorNilCheck(pass, stmt.Cond) {
					return true
				}
				errorNames := checkedErrorNames(pass, stmt.Cond)
				for _, bodyStmt := range stmt.Body.List {
					ret, ok := bodyStmt.(*ast.ReturnStmt)
					if !ok {
						continue
					}
					if !returnContainsCheckedError(ret, errorNames) {
						pass.Reportf(ret.Pos(), "error path returns without propagating the checked error")
					}
				}
				return true
			})
			return false
		})
	}
	return nil, nil
}

func funcReturnsError(pass *analysis.Pass, fn *ast.FuncDecl) bool {
	obj := pass.TypesInfo.Defs[fn.Name]
	if obj == nil {
		return false
	}
	sig, ok := obj.Type().(*types.Signature)
	if !ok {
		return false
	}
	results := sig.Results()
	for i := 0; i < results.Len(); i++ {
		if analyzerutil.IsErrorType(results.At(i).Type()) {
			return true
		}
	}
	return false
}

func checkedErrorNames(pass *analysis.Pass, expr ast.Expr) map[string]bool {
	names := map[string]bool{}
	ast.Inspect(expr, func(n ast.Node) bool {
		ident, ok := n.(*ast.Ident)
		if ok && analyzerutil.ExprIsError(pass, ident) {
			names[ident.Name] = true
		}
		return true
	})
	return names
}

func returnContainsCheckedError(ret *ast.ReturnStmt, names map[string]bool) bool {
	found := false
	for _, result := range ret.Results {
		ast.Inspect(result, func(n ast.Node) bool {
			if found || n == nil {
				return !found
			}
			ident, ok := n.(*ast.Ident)
			if ok && names[ident.Name] {
				found = true
				return false
			}
			return true
		})
	}
	return found
}
