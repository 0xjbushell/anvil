package requiretests

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/analysis"
	"tools/go-analyzers/internal/analyzerutil"
)

var sourceDirs string

var Analyzer = &analysis.Analyzer{Name: "requiretests", Doc: "reports source files without same-directory tests", Run: run}

func init() {
	Analyzer.Flags.StringVar(&sourceDirs, "source-dirs", "internal/,pkg/", "comma-separated source directories to require tests for")
}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		path := analyzerutil.FileName(pass, file)
		if analyzerutil.IsTestFile(path) || !inSourceDir(path) || exempt(path) {
			continue
		}
		testPath := strings.TrimSuffix(path, ".go") + "_test.go"
		if _, err := os.Stat(testPath); err != nil {
			pass.Reportf(file.Package, "source file %s has no same-directory _test.go file", filepath.Base(path))
		}
	}
	return nil, nil
}

func inSourceDir(path string) bool {
	slash := filepath.ToSlash(path)
	for _, dir := range strings.Split(sourceDirs, ",") {
		dir = strings.TrimSpace(filepath.ToSlash(dir))
		if dir == "" {
			continue
		}
		dir = strings.Trim(dir, "/")
		if strings.Contains(slash, "/"+dir+"/") || strings.HasPrefix(slash, dir+"/") {
			return true
		}
	}
	return false
}

func exempt(path string) bool {
	slash := filepath.ToSlash(path)
	base := filepath.Base(slash)
	switch base {
	case "types.go", "errors.go", "constants.go", "enums.go", "doc.go":
		return true
	}
	return strings.Contains(slash, "/cmd/") && base == "main.go"
}
