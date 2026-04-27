package noemptytest

import (
	"go/ast"
	"go/types"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{Name: "noemptytest", Doc: "reports Test functions with no assertions", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Body == nil || !isGoTestFunction(pass, fn) {
				continue
			}
			testingTNames := testingTParamNames(fn)
			found := false
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				if found || n == nil {
					return !found
				}
				call, ok := n.(*ast.CallExpr)
				if ok && isAssertion(pass, call, testingTNames) {
					found = true
					return false
				}
				return true
			})
			if !found {
				pass.Reportf(fn.Pos(), "test %s has no assertions", fn.Name.Name)
			}
		}
	}
	return nil, nil
}

func isGoTestFunction(pass *analysis.Pass, fn *ast.FuncDecl) bool {
	name := fn.Name.Name
	if name == "TestMain" || !strings.HasPrefix(name, "Test") || !testNameBoundary(name) {
		return false
	}
	if fn.Type.Params == nil || len(fn.Type.Params.List) != 1 || len(fn.Type.Params.List[0].Names) != 1 {
		return false
	}
	tv, ok := pass.TypesInfo.Types[fn.Type.Params.List[0].Type]
	return ok && tv.Type != nil && tv.Type.String() == "*testing.T"
}

func testNameBoundary(name string) bool {
	if len(name) == len("Test") {
		return true
	}
	r, _ := utf8.DecodeRuneInString(name[len("Test"):])
	return r != utf8.RuneError && !unicode.IsLower(r)
}

func testingTParamNames(fn *ast.FuncDecl) map[string]bool {
	names := map[string]bool{}
	if fn.Type.Params == nil {
		return names
	}
	for _, field := range fn.Type.Params.List {
		for _, name := range field.Names {
			names[name.Name] = true
		}
	}
	return names
}

func isAssertion(pass *analysis.Pass, call *ast.CallExpr, testingTNames map[string]bool) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	if strings.HasPrefix(sel.Sel.Name, "Error") || strings.HasPrefix(sel.Sel.Name, "Fatal") || strings.HasPrefix(sel.Sel.Name, "Fail") {
		if ident, ok := sel.X.(*ast.Ident); ok && testingTNames[ident.Name] {
			return true
		}
	}
	if ident, ok := sel.X.(*ast.Ident); ok && (ident.Name == "assert" || ident.Name == "require") && isImportedPackage(pass, ident) {
		return true
	}
	return false
}

func isImportedPackage(pass *analysis.Pass, ident *ast.Ident) bool {
	obj := pass.TypesInfo.Uses[ident]
	_, ok := obj.(*types.PkgName)
	return ok
}
