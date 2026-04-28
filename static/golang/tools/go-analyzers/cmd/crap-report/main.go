package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type coverageBlock struct {
	file       string
	startLine  int
	endLine    int
	statements int
	count      int
}

type functionReport struct {
	file       string
	name       string
	startLine  int
	endLine    int
	complexity int
	coverage   float64
	crap       float64
}

type thresholds struct {
	warn  float64
	error float64
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("crap-report", flag.ContinueOnError)
	flags.SetOutput(stderr)
	rootFlag := flags.String("root", "", "project root containing coverage.out")
	coverFlag := flags.String("coverprofile", "", "coverage profile path")
	warnFlag := flags.Float64("warn-threshold", 30, "CRAP warning threshold")
	errorFlag := flags.Float64("error-threshold", 45, "CRAP error threshold")
	if err := flags.Parse(args); err != nil {
		return 1
	}

	root := resolveRoot(*rootFlag)
	coverPath := resolveCoveragePath(root, *coverFlag)
	reports, err := buildReports(root, coverPath)
	if err != nil {
		fmt.Fprintf(stderr, "crap-report: %v\n", err)
		return 1
	}

	if writeReports(stdout, reports, thresholds{warn: *warnFlag, error: *errorFlag}) {
		return 1
	}
	return 0
}

func resolveRoot(rootFlag string) string {
	if rootFlag != "" {
		return filepath.Clean(rootFlag)
	}
	if fileExists("coverage.out") {
		return "."
	}
	if fileExists(filepath.Join("..", "..", "coverage.out")) {
		return filepath.Join("..", "..")
	}
	return "."
}

func resolveCoveragePath(root string, coverFlag string) string {
	if coverFlag != "" {
		return coverFlag
	}
	return filepath.Join(root, "coverage.out")
}

func fileExists(filePath string) bool {
	_, err := os.Stat(filePath)
	return err == nil
}

func buildReports(root string, coverPath string) ([]functionReport, error) {
	blocks, err := parseCoverageFile(coverPath)
	if err != nil {
		return nil, err
	}
	byFile := groupBlocksByFile(blocks)
	reports := make([]functionReport, 0)

	for fileName, fileBlocks := range byFile {
		fileReports, err := analyzeFile(root, fileName, fileBlocks)
		if err != nil {
			return nil, err
		}
		reports = append(reports, fileReports...)
	}

	sort.Slice(reports, func(i int, j int) bool {
		if reports[i].crap == reports[j].crap {
			return reports[i].name < reports[j].name
		}
		return reports[i].crap > reports[j].crap
	})
	return reports, nil
}

func parseCoverageFile(filePath string) ([]coverageBlock, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open coverage profile: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	blocks := make([]coverageBlock, 0)
	for scanner.Scan() {
		var err error
		blocks, err = appendCoverageLine(blocks, scanner.Text())
		if err != nil {
			return nil, err
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read coverage profile: %w", err)
	}
	if len(blocks) == 0 {
		return nil, errors.New("coverage profile contains no blocks")
	}
	return blocks, nil
}

func appendCoverageLine(blocks []coverageBlock, text string) ([]coverageBlock, error) {
	line := strings.TrimSpace(text)
	if line == "" || strings.HasPrefix(line, "mode:") {
		return blocks, nil
	}
	block, err := parseCoverageLine(line)
	if err != nil {
		return nil, err
	}
	return append(blocks, block), nil
}

func parseCoverageLine(line string) (coverageBlock, error) {
	fields := strings.Fields(line)
	if len(fields) != 3 {
		return coverageBlock{}, fmt.Errorf("invalid coverage line %q", line)
	}
	fileName, startLine, endLine, err := parseCoverageRange(fields[0])
	if err != nil {
		return coverageBlock{}, err
	}
	statements, err := strconv.Atoi(fields[1])
	if err != nil {
		return coverageBlock{}, fmt.Errorf("invalid statement count in %q: %w", line, err)
	}
	count, err := strconv.Atoi(fields[2])
	if err != nil {
		return coverageBlock{}, fmt.Errorf("invalid hit count in %q: %w", line, err)
	}
	return coverageBlock{file: fileName, startLine: startLine, endLine: endLine, statements: statements, count: count}, nil
}

func parseCoverageRange(value string) (string, int, int, error) {
	fileName, positionRange, ok := strings.Cut(value, ":")
	if !ok {
		return "", 0, 0, fmt.Errorf("missing file separator in coverage range %q", value)
	}
	startPosition, endPosition, ok := strings.Cut(positionRange, ",")
	if !ok {
		return "", 0, 0, fmt.Errorf("missing position separator in coverage range %q", value)
	}
	startLine, err := parseLineNumber(startPosition)
	if err != nil {
		return "", 0, 0, err
	}
	endLine, err := parseLineNumber(endPosition)
	if err != nil {
		return "", 0, 0, err
	}
	return fileName, startLine, endLine, nil
}

func parseLineNumber(position string) (int, error) {
	lineText, _, ok := strings.Cut(position, ".")
	if !ok {
		return 0, fmt.Errorf("invalid coverage position %q", position)
	}
	lineNumber, err := strconv.Atoi(lineText)
	if err != nil {
		return 0, fmt.Errorf("invalid coverage line %q: %w", position, err)
	}
	return lineNumber, nil
}

func groupBlocksByFile(blocks []coverageBlock) map[string][]coverageBlock {
	byFile := make(map[string][]coverageBlock)
	for _, block := range blocks {
		byFile[block.file] = append(byFile[block.file], block)
	}
	return byFile
}

func analyzeFile(root string, fileName string, blocks []coverageBlock) ([]functionReport, error) {
	filePath := resolveSourceFile(root, fileName)
	fileSet := token.NewFileSet()
	parsed, err := parser.ParseFile(fileSet, filePath, nil, 0)
	if err != nil {
		return nil, fmt.Errorf("parse source %s: %w", fileName, err)
	}

	reports := make([]functionReport, 0)
	for _, decl := range parsed.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Body == nil {
			continue
		}
		startLine := fileSet.Position(fn.Pos()).Line
		endLine := fileSet.Position(fn.End()).Line
		complexity := cyclomaticComplexity(fn)
		coverage := functionCoverage(startLine, endLine, blocks)
		reports = append(reports, functionReport{
			file:       fileName,
			name:       functionName(fn),
			startLine:  startLine,
			endLine:    endLine,
			complexity: complexity,
			coverage:   coverage,
			crap:       crapScore(complexity, coverage),
		})
	}
	return reports, nil
}

func resolveSourceFile(root string, fileName string) string {
	if filepath.IsAbs(fileName) {
		return fileName
	}

	directPath := filepath.Join(root, fileName)
	if fileExists(directPath) {
		return directPath
	}

	modulePath := readModulePath(filepath.Join(root, "go.mod"))
	relativePath, ok := strings.CutPrefix(fileName, modulePath+"/")
	if ok {
		return filepath.Join(root, relativePath)
	}
	return directPath
}

func readModulePath(goModPath string) string {
	content, err := os.ReadFile(goModPath)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "module" {
			return fields[1]
		}
	}
	return ""
}

func functionName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	return fmt.Sprintf("%s.%s", receiverName(fn.Recv.List[0].Type), fn.Name.Name)
}

func receiverName(expr ast.Expr) string {
	switch value := expr.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.StarExpr:
		return receiverName(value.X)
	case *ast.IndexExpr:
		return receiverName(value.X)
	case *ast.IndexListExpr:
		return receiverName(value.X)
	default:
		return "receiver"
	}
}

func cyclomaticComplexity(fn *ast.FuncDecl) int {
	complexity := 1
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		complexity += complexityContribution(node)
		return true
	})
	return complexity
}

func complexityContribution(node ast.Node) int {
	switch value := node.(type) {
	case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt, *ast.SwitchStmt, *ast.TypeSwitchStmt:
		return 1
	case *ast.CaseClause:
		return boolScore(len(value.List) > 0)
	case *ast.CommClause:
		return boolScore(value.Comm != nil)
	case *ast.BinaryExpr:
		return boolScore(value.Op == token.LAND || value.Op == token.LOR)
	default:
		return 0
	}
}

func boolScore(value bool) int {
	if value {
		return 1
	}
	return 0
}

func functionCoverage(startLine int, endLine int, blocks []coverageBlock) float64 {
	coveredStatements := 0
	totalStatements := 0
	for _, block := range blocks {
		if block.endLine < startLine || block.startLine > endLine {
			continue
		}
		totalStatements += block.statements
		if block.count > 0 {
			coveredStatements += block.statements
		}
	}
	if totalStatements == 0 {
		return 0
	}
	return float64(coveredStatements) / float64(totalStatements)
}

func crapScore(complexity int, coverage float64) float64 {
	uncovered := 1 - coverage
	return math.Pow(float64(complexity), 2)*math.Pow(uncovered, 3) + float64(complexity)
}

func writeReports(output io.Writer, reports []functionReport, limits thresholds) bool {
	fmt.Fprintf(output, "CRAP report\n")
	fmt.Fprintf(output, "%-8s %-6s %-7s %-8s %s\n", "CRAP", "CPLX", "COV", "STATUS", "FUNCTION")

	hasError := false
	for _, report := range reports {
		status := "ok"
		if report.crap > limits.error {
			status = "error"
			hasError = true
		} else if report.crap > limits.warn {
			status = "warn"
		}
		fmt.Fprintf(
			output,
			"%-8.2f %-6d %-6.1f%% %-8s %s:%d %s\n",
			report.crap,
			report.complexity,
			report.coverage*100,
			status,
			report.file,
			report.startLine,
			report.name,
		)
	}
	return hasError
}
