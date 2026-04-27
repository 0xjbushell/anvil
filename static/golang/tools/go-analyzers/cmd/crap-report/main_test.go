package main

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"math"
	"testing"
)

func TestRunReturnsSuccessAndFailureCodes(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	code := run([]string{"--root", ".", "--coverprofile", "testdata/coverage.out", "--error-threshold", "100"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("run success code = %d, want 0; stderr=%s", code, stderr.String())
	}
	if !bytes.Contains(stdout.Bytes(), []byte("CRAP report")) {
		t.Fatalf("stdout = %q, want CRAP report", stdout.String())
	}

	code = run([]string{"--coverprofile", "testdata/missing.out"}, &stdout, &stderr)
	if code != 1 {
		t.Fatalf("run failure code = %d, want 1", code)
	}
}

func TestParseCoverageFile(t *testing.T) {
	blocks, err := parseCoverageFile("testdata/coverage.out")
	if err != nil {
		t.Fatalf("parseCoverageFile returned error: %v", err)
	}
	if len(blocks) != 3 {
		t.Fatalf("len(blocks) = %d, want 3", len(blocks))
	}
	if blocks[0].file != "testdata/sample/sample.go" {
		t.Fatalf("file = %q", blocks[0].file)
	}
	if blocks[0].startLine != 3 || blocks[0].endLine != 5 {
		t.Fatalf("range = %d..%d, want 3..5", blocks[0].startLine, blocks[0].endLine)
	}
}

func TestBuildReportsComputesComplexityCoverageAndCRAP(t *testing.T) {
	reports, err := buildReports(".", "testdata/coverage.out")
	if err != nil {
		t.Fatalf("buildReports returned error: %v", err)
	}

	byName := mapReportsByName(reports)
	covered := byName["Covered"]
	if covered.complexity != 2 {
		t.Fatalf("Covered complexity = %d, want 2", covered.complexity)
	}
	assertClose(t, covered.coverage, 1)
	assertClose(t, covered.crap, 2)

	uncovered := byName["Uncovered"]
	if uncovered.complexity != 2 {
		t.Fatalf("Uncovered complexity = %d, want 2", uncovered.complexity)
	}
	assertClose(t, uncovered.coverage, 0)
	assertClose(t, uncovered.crap, 6)
}

func TestBuildReportsStripsModulePrefixFromCoveragePaths(t *testing.T) {
	reports, err := buildReports("../..", "testdata/module_coverage.out")
	if err != nil {
		t.Fatalf("buildReports returned error: %v", err)
	}

	if _, ok := mapReportsByName(reports)["Covered"]; !ok {
		t.Fatal("module-prefixed coverage path did not resolve Covered function")
	}
}

func TestParseCoverageFileRejectsMalformedProfiles(t *testing.T) {
	_, err := parseCoverageFile("testdata/invalid_coverage.out")
	if err == nil {
		t.Fatal("parseCoverageFile returned nil error, want malformed profile failure")
	}
}

func TestParseCoverageFileRejectsEmptyProfiles(t *testing.T) {
	_, err := parseCoverageFile("testdata/empty_coverage.out")
	if err == nil {
		t.Fatal("parseCoverageFile returned nil error, want failure for empty profile")
	}
}

func TestReceiverNameHandlesPointerAndGenericReceivers(t *testing.T) {
	fileSet := token.NewFileSet()
	source := "package sample\ntype Box[T any] struct{}\ntype Pair[K any, V any] struct{}\nfunc (b *Box[T]) Value() {}\nfunc (p Pair[K, V]) First() {}"
	parsed, err := parser.ParseFile(fileSet, "receiver.go", source, 0)
	if err != nil {
		t.Fatalf("ParseFile returned error: %v", err)
	}
	tests := []struct {
		name string
		decl ast.Decl
		want string
	}{
		{name: "generic pointer", decl: parsed.Decls[2], want: "Box"},
		{name: "generic value", decl: parsed.Decls[3], want: "Pair"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fn := tt.decl.(*ast.FuncDecl)
			if got := receiverName(fn.Recv.List[0].Type); got != tt.want {
				t.Fatalf("receiverName = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCyclomaticComplexityCountsBranches(t *testing.T) {
	fileSet := token.NewFileSet()
	parsed, err := parser.ParseFile(fileSet, "sample.go", complexitySource, 0)
	if err != nil {
		t.Fatalf("ParseFile returned error: %v", err)
	}
	fn := parsed.Decls[0].(*ast.FuncDecl)
	if got := cyclomaticComplexity(fn); got != 6 {
		t.Fatalf("cyclomaticComplexity = %d, want 6", got)
	}
}

func TestComplexityContributionHandlesNodeKinds(t *testing.T) {
	tests := []struct {
		name string
		node ast.Node
		want int
	}{
		{name: "for", node: &ast.ForStmt{}, want: 1},
		{name: "type switch", node: &ast.TypeSwitchStmt{}, want: 1},
		{name: "non default case", node: &ast.CaseClause{List: []ast.Expr{ast.NewIdent("x")}}, want: 1},
		{name: "default case", node: &ast.CaseClause{}, want: 0},
		{name: "comm clause", node: &ast.CommClause{Comm: &ast.SendStmt{}}, want: 1},
		{name: "default comm", node: &ast.CommClause{}, want: 0},
		{name: "logical or", node: &ast.BinaryExpr{Op: token.LOR}, want: 1},
		{name: "addition", node: &ast.BinaryExpr{Op: token.ADD}, want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := complexityContribution(tt.node); got != tt.want {
				t.Fatalf("complexityContribution = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestWriteReportsFlagsThresholdBreaches(t *testing.T) {
	reports := []functionReport{
		{name: "risky", file: "sample.go", startLine: 1, complexity: 8, coverage: 0, crap: 72},
	}

	if !writeReports(io.Discard, reports, thresholds{warn: 30, error: 45}) {
		t.Fatal("writeReports returned false, want true for error threshold breach")
	}
}

const complexitySource = `package sample
func Branchy(a bool, b bool, values []int) int {
	if a && b {
		return 1
	}
	for _, value := range values {
		switch value {
		case 1:
			return value
		default:
			return 0
		}
	}
	return 0
}
`

func mapReportsByName(reports []functionReport) map[string]functionReport {
	mapped := make(map[string]functionReport)
	for _, report := range reports {
		mapped[report.name] = report
	}
	return mapped
}

func assertClose(t *testing.T, got float64, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.001 {
		t.Fatalf("value = %.3f, want %.3f", got, want)
	}
}
