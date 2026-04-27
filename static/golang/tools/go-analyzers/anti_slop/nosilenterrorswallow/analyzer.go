package nosilenterrorswallow

import (
	"go/ast"
	"go/token"
	"go/types"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var Analyzer = &analysis.Analyzer{Name: "nosilenterrorswallow", Doc: "reports error checks that silently swallow errors", Run: run}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		ast.Inspect(file, func(n ast.Node) bool {
			switch stmt := n.(type) {
			case *ast.IfStmt:
				if stmt.Body == nil || !analyzerutil.IsErrorNilCheck(pass, stmt.Cond) {
					return true
				}
				if analyzerutil.HasHandlingComment(pass, stmt.Body.Pos(), stmt.Body.End()) {
					return true
				}
				if len(stmt.Body.List) == 0 {
					pass.Reportf(stmt.Pos(), "error is silently swallowed; handle it or add an explicit suppression comment")
					return true
				}
				onlyBranches := true
				for _, child := range stmt.Body.List {
					branch, ok := child.(*ast.BranchStmt)
					if !ok || (branch.Tok != token.BREAK && branch.Tok != token.CONTINUE) {
						onlyBranches = false
						break
					}
				}
				if onlyBranches {
					pass.Reportf(stmt.Pos(), "error is silently swallowed by break/continue; handle it or add an explicit suppression comment")
				}
			case *ast.AssignStmt:
				if assignmentDiscardsError(pass, stmt) && !hasAdjacentHandlingComment(pass, stmt) {
					pass.Reportf(stmt.Pos(), "error is silently swallowed; handle it or add an explicit suppression comment")
				}
			}
			return true
		})
	}
	return nil, nil
}

func assignmentDiscardsError(pass *analysis.Pass, stmt *ast.AssignStmt) bool {
	if len(stmt.Rhs) == 1 {
		results := errorResultPositions(pass, stmt.Rhs[0])
		for i, lhs := range stmt.Lhs {
			ident, ok := lhs.(*ast.Ident)
			if ok && ident.Name == "_" && results[i] {
				return true
			}
		}
		return false
	}
	for i, lhs := range stmt.Lhs {
		ident, ok := lhs.(*ast.Ident)
		if !ok || ident.Name != "_" || i >= len(stmt.Rhs) {
			continue
		}
		if exprReturnsError(pass, stmt.Rhs[i]) {
			return true
		}
	}
	return false
}

func errorResultPositions(pass *analysis.Pass, expr ast.Expr) map[int]bool {
	positions := map[int]bool{}
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return positions
	}
	tv, ok := pass.TypesInfo.Types[call]
	if !ok || tv.Type == nil {
		return positions
	}
	if analyzerutil.IsErrorType(tv.Type) {
		positions[0] = true
		return positions
	}
	tuple, ok := tv.Type.(*types.Tuple)
	if !ok {
		return positions
	}
	for i := 0; i < tuple.Len(); i++ {
		if analyzerutil.IsErrorType(tuple.At(i).Type()) {
			positions[i] = true
		}
	}
	return positions
}

func exprReturnsError(pass *analysis.Pass, expr ast.Expr) bool {
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return false
	}
	tv, ok := pass.TypesInfo.Types[call]
	if !ok || tv.Type == nil {
		return false
	}
	if analyzerutil.IsErrorType(tv.Type) {
		return true
	}
	tuple, ok := tv.Type.(*types.Tuple)
	if !ok {
		return false
	}
	for i := 0; i < tuple.Len(); i++ {
		if analyzerutil.IsErrorType(tuple.At(i).Type()) {
			return true
		}
	}
	return false
}

func hasAdjacentHandlingComment(pass *analysis.Pass, stmt ast.Stmt) bool {
	if analyzerutil.HasHandlingComment(pass, stmt.Pos(), stmt.End()) {
		return true
	}
	stmtFile := pass.Fset.File(stmt.Pos())
	if stmtFile == nil {
		return false
	}
	stmtLine := stmtFile.Line(stmt.Pos())
	for _, file := range pass.Files {
		for _, group := range file.Comments {
			commentFile := pass.Fset.File(group.Pos())
			if commentFile == nil || commentFile.Name() != stmtFile.Name() {
				continue
			}
			if commentFile.Line(group.End()) != stmtLine-1 {
				continue
			}
			if analyzerutil.HasHandlingComment(pass, group.Pos(), group.End()) {
				return true
			}
		}
	}
	return false
}
