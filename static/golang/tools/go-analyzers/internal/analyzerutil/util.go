package analyzerutil

import (
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/tools/go/analysis"
)

var errorInterface = types.Universe.Lookup("error").Type().Underlying().(*types.Interface)

func IsErrorType(t types.Type) bool {
	if t == nil {
		return false
	}
	return types.Implements(t, errorInterface) || types.Implements(types.NewPointer(t), errorInterface)
}

func ExprIsError(pass *analysis.Pass, expr ast.Expr) bool {
	if expr == nil {
		return false
	}
	tv, ok := pass.TypesInfo.Types[expr]
	return ok && IsErrorType(tv.Type)
}

func IsNil(expr ast.Expr) bool {
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == "nil"
}

func IsErrorNilCheck(pass *analysis.Pass, expr ast.Expr) bool {
	bin, ok := expr.(*ast.BinaryExpr)
	if !ok || (bin.Op != token.NEQ && bin.Op != token.EQL) {
		return false
	}
	return (IsNil(bin.X) && ExprIsError(pass, bin.Y)) || (IsNil(bin.Y) && ExprIsError(pass, bin.X))
}

func HasHandlingComment(pass *analysis.Pass, start, end token.Pos) bool {
	for _, file := range pass.Files {
		for _, group := range file.Comments {
			if group.Pos() < start || group.End() > end {
				continue
			}
			text := strings.ToLower(group.Text())
			if strings.Contains(text, "intentional") || strings.Contains(text, "ignored") || strings.Contains(text, "ignore") || strings.Contains(text, "best-effort") || strings.Contains(text, "best effort") || strings.Contains(text, "suppress") || strings.Contains(text, "expected") {
				return true
			}
		}
	}
	return false
}

func IsLogCall(pass *analysis.Pass, call *ast.CallExpr) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	name := strings.ToLower(sel.Sel.Name)
	recv, _ := sel.X.(*ast.Ident)
	if recv != nil && (isLogPackage(pass, recv, "fmt") || isLogPackage(pass, recv, "errors")) {
		return false
	}
	if recv != nil && isLogPackage(pass, recv, "log") && (strings.HasPrefix(name, "print") || strings.HasPrefix(name, "fatal") || strings.HasPrefix(name, "panic")) {
		return true
	}
	if recv != nil && isLogPackage(pass, recv, "log/slog") && isLoggerMethodName(name) {
		return true
	}
	if recv != nil && isLoggerMethodName(name) && isCommonLoggerIdentifier(strings.ToLower(recv.Name)) {
		return true
	}
	if isLoggerMethodName(name) && receiverTypeLooksLogger(pass, sel.X) {
		return true
	}
	return false
}

func IsWarnErrorFatalLogCall(pass *analysis.Pass, call *ast.CallExpr) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	if !IsLogCall(pass, call) {
		return false
	}
	name := strings.ToLower(sel.Sel.Name)
	return strings.HasPrefix(name, "error") || strings.HasPrefix(name, "warn") || strings.HasPrefix(name, "fatal") || strings.HasPrefix(name, "panic")
}

func IsExprLogCall(pass *analysis.Pass, expr ast.Expr) bool {
	call, ok := expr.(*ast.CallExpr)
	return ok && IsLogCall(pass, call)
}

func ContainsErrorExpr(pass *analysis.Pass, expr ast.Expr) bool {
	found := false
	ast.Inspect(expr, func(n ast.Node) bool {
		if found || n == nil {
			return !found
		}
		if e, ok := n.(ast.Expr); ok && ExprIsError(pass, e) && !IsNil(e) {
			found = true
			return false
		}
		return true
	})
	return found
}

func ReturnHasError(pass *analysis.Pass, ret *ast.ReturnStmt) bool {
	for _, result := range ret.Results {
		if ContainsErrorExpr(pass, result) {
			return true
		}
	}
	return false
}

func FileName(pass *analysis.Pass, file *ast.File) string {
	return filepath.ToSlash(pass.Fset.File(file.Pos()).Name())
}

func BaseName(path string) string {
	return strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
}

func IsTestFile(path string) bool {
	return strings.HasSuffix(path, "_test.go")
}

func IsTestingT(pass *analysis.Pass, expr ast.Expr) bool {
	tv, ok := pass.TypesInfo.Types[expr]
	if !ok || tv.Type == nil {
		return false
	}
	return strings.TrimPrefix(tv.Type.String(), "*") == "testing.T"
}

func IsStringFormatting(expr ast.Expr) bool {
	switch e := expr.(type) {
	case *ast.BinaryExpr:
		return e.Op == token.ADD && ContainsStringLiteral(e)
	case *ast.CallExpr:
		sel, ok := e.Fun.(*ast.SelectorExpr)
		if !ok {
			return false
		}
		if ident, ok := sel.X.(*ast.Ident); ok && ident.Name == "fmt" && strings.HasPrefix(sel.Sel.Name, "Sprint") {
			return true
		}
	}
	return false
}

func ContainsStringLiteral(expr ast.Expr) bool {
	found := false
	ast.Inspect(expr, func(n ast.Node) bool {
		if found || n == nil {
			return !found
		}
		lit, ok := n.(*ast.BasicLit)
		if ok && lit.Kind == token.STRING {
			found = true
			return false
		}
		return true
	})
	return found
}

func isLoggerMethodName(name string) bool {
	return strings.HasPrefix(name, "debug") ||
		strings.HasPrefix(name, "info") ||
		strings.HasPrefix(name, "warn") ||
		strings.HasPrefix(name, "error") ||
		strings.HasPrefix(name, "fatal") ||
		strings.HasPrefix(name, "panic") ||
		name == "print" ||
		name == "printf" ||
		name == "println"
}

func isCommonLoggerIdentifier(name string) bool {
	switch name {
	case "log", "logger", "logr", "slog", "zap", "sugar":
		return true
	default:
		return false
	}
}

func isLogPackage(pass *analysis.Pass, ident *ast.Ident, importPath string) bool {
	obj, ok := pass.TypesInfo.Uses[ident].(*types.PkgName)
	return ok && obj.Imported() != nil && obj.Imported().Path() == importPath
}

func receiverTypeLooksLogger(pass *analysis.Pass, expr ast.Expr) bool {
	tv, ok := pass.TypesInfo.Types[expr]
	if !ok || tv.Type == nil {
		return false
	}
	t := tv.Type
	if ptr, ok := t.(*types.Pointer); ok {
		t = ptr.Elem()
	}
	named, ok := t.(*types.Named)
	if !ok || named.Obj() == nil {
		return false
	}
	name := strings.ToLower(named.Obj().Name())
	return strings.Contains(name, "logger") || name == "entry"
}

func LiteralValue(expr ast.Expr) (string, bool) {
	lit, ok := expr.(*ast.BasicLit)
	if !ok {
		if ident, ok := expr.(*ast.Ident); ok && (ident.Name == "true" || ident.Name == "false" || ident.Name == "nil") {
			return ident.Name, true
		}
		return "", false
	}
	if lit.Kind == token.STRING {
		value, err := strconv.Unquote(lit.Value)
		if err == nil {
			return value, true
		}
	}
	return lit.Value, true
}
