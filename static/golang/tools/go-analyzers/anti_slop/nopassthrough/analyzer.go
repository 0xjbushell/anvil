package nopassthrough

import (
	"go/ast"

	"golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{Name: "nopassthrough", Doc: "reports pass-through wrappers that only return another call with identical args", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Body == nil || fn.Type.Params == nil || len(fn.Body.List) != 1 {
				continue
			}
			params := paramNames(fn.Type.Params)
			if len(params) == 0 {
				continue
			}
			ret, ok := fn.Body.List[0].(*ast.ReturnStmt)
			if !ok || len(ret.Results) != 1 {
				continue
			}
			call, ok := ret.Results[0].(*ast.CallExpr)
			if !ok || len(call.Args) != len(params) || isBuiltin(call.Fun) {
				continue
			}
			same := true
			for i, arg := range call.Args {
				ident, ok := arg.(*ast.Ident)
				if !ok || ident.Name != params[i] {
					same = false
					break
				}
			}
			if same {
				pass.Reportf(fn.Pos(), "pass-through wrapper adds no behavior")
			}
		}
	}
	return nil, nil
}

func paramNames(fields *ast.FieldList) []string {
	var names []string
	for _, field := range fields.List {
		for _, name := range field.Names {
			names = append(names, name.Name)
		}
	}
	return names
}

func isBuiltin(expr ast.Expr) bool {
	ident, ok := expr.(*ast.Ident)
	if !ok {
		return false
	}
	switch ident.Name {
	case "append", "cap", "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max", "min", "new", "panic", "print", "println", "real", "recover":
		return true
	default:
		return false
	}
}
