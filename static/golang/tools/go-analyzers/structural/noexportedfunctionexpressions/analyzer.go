package noexportedfunctionexpressions

import (
	"go/ast"
	"go/token"

	"golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{Name: "noexportedfunctionexpressions", Doc: "reports exported function values; use function declarations", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.VAR {
				continue
			}
			for _, spec := range gen.Specs {
				valueSpec, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range valueSpec.Names {
					if !name.IsExported() || i >= len(valueSpec.Values) {
						continue
					}
					if _, ok := valueSpec.Values[i].(*ast.FuncLit); ok {
						pass.Reportf(name.Pos(), "exported function expression %s should be a function declaration", name.Name)
					}
				}
			}
		}
	}
	return nil, nil
}
