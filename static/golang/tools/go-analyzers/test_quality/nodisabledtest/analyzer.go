package nodisabledtest

import (
	"go/ast"
	"strings"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "nodisabledtest", Doc: "reports t.Skip calls without an explanation", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil || !strings.HasPrefix(fn.Name.Name, "Test") {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if sel.Sel.Name != "Skip" && sel.Sel.Name != "Skipf" && sel.Sel.Name != "SkipNow" {
					return true
				}
				if len(call.Args) == 0 {
					pass.Reportf(call.Pos(), "disabled test needs an explanation")
					return true
				}
				if value, ok := analyzerutil.LiteralValue(call.Args[0]); ok && strings.TrimSpace(value) == "" {
					pass.Reportf(call.Pos(), "disabled test needs an explanation")
				}
				return true
			})
		}
	}
	return nil, nil
}
