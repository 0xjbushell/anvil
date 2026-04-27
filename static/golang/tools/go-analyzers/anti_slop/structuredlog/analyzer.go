package structuredlog

import (
	"go/ast"
	"strings"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "structuredlog", Doc: "reports unstructured logging and formatted logger messages", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			if ident, ok := call.Fun.(*ast.Ident); ok && (ident.Name == "print" || ident.Name == "println") {
				pass.Reportf(call.Pos(), "use a structured logger instead of builtin %s", ident.Name)
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			recv, _ := sel.X.(*ast.Ident)
			name := sel.Sel.Name
			if recv != nil && recv.Name == "fmt" && strings.HasPrefix(name, "Print") {
				pass.Reportf(call.Pos(), "use a structured logger instead of fmt.%s", name)
				return true
			}
			if recv != nil && recv.Name == "log" && (strings.HasPrefix(name, "Print") || strings.HasPrefix(name, "Fatal") || strings.HasPrefix(name, "Panic")) {
				pass.Reportf(call.Pos(), "use a structured logger instead of log.%s", name)
				return true
			}
			if analyzerutil.IsLogCall(pass, call) {
				for _, arg := range call.Args {
					if analyzerutil.IsStringFormatting(arg) {
						pass.Reportf(arg.Pos(), "structured logger messages must not use string formatting or concatenation")
					}
				}
			}
			return true
		})
	}
	return nil, nil
}
