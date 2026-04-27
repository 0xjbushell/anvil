package requireerrortest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "requireerrortest", Doc: "reports error-handling source files without error-path tests", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		path := analyzerutil.FileName(pass, file)
		if analyzerutil.IsTestFile(path) || !hasErrorHandling(pass, file) {
			continue
		}
		test := correspondingTestFile(pass, path)
		if test == nil {
			parsedTest, err := parseExistingTestFile(pass, strings.TrimSuffix(path, ".go")+"_test.go")
			if err != nil {
				continue
			}
			test = parsedTest
		}
		if !hasErrorAssertion(pass, test) {
			pass.Reportf(file.Package, "source file with error handling needs a corresponding error-path test")
		}
	}
	return nil, nil
}

func hasErrorHandling(pass *analysis.Pass, file *ast.File) bool {
	found := false
	ast.Inspect(file, func(n ast.Node) bool {
		if found || n == nil {
			return !found
		}
		if stmt, ok := n.(*ast.IfStmt); ok && analyzerutil.IsErrorNilCheck(pass, stmt.Cond) {
			found = true
			return false
		}
		return true
	})
	return found
}

func hasErrorAssertion(pass *analysis.Pass, file *ast.File) bool {
	found := false
	ast.Inspect(file, func(n ast.Node) bool {
		if found || n == nil {
			return !found
		}
		switch node := n.(type) {
		case *ast.IfStmt:
			if analyzerutil.IsErrorNilCheck(pass, node.Cond) || isErrNilCheck(node.Cond) {
				found = true
				return false
			}
		case *ast.CallExpr:
			sel, ok := node.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if ident, ok := sel.X.(*ast.Ident); ok && (ident.Name == "assert" || ident.Name == "require") {
				switch sel.Sel.Name {
				case "Error", "ErrorIs", "ErrorAs", "EqualError", "NotNil":
					found = true
					return false
				}
			}
		}
		return true
	})
	return found
}

func correspondingTestFile(pass *analysis.Pass, sourcePath string) *ast.File {
	testPath := strings.TrimSuffix(sourcePath, ".go") + "_test.go"
	for _, file := range pass.Files {
		if analyzerutil.FileName(pass, file) == testPath {
			return file
		}
	}
	return nil
}

func parseExistingTestFile(pass *analysis.Pass, path string) (*ast.File, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parser.ParseFile(pass.Fset, path, content, 0)
}

func isErrNilCheck(expr ast.Expr) bool {
	bin, ok := expr.(*ast.BinaryExpr)
	if !ok || (bin.Op != token.NEQ && bin.Op != token.EQL) {
		return false
	}
	left, lok := bin.X.(*ast.Ident)
	right, rok := bin.Y.(*ast.Ident)
	return (lok && left.Name == "err" && rok && right.Name == "nil") || (rok && right.Name == "err" && lok && left.Name == "nil")
}
