package filelength

import (
	"bytes"

	"golang.org/x/tools/go/analysis"
)

var maxLines int

var Analyzer = &analysis.Analyzer{Name: "filelength", Doc: "reports files exceeding the configured line threshold", Run: run}

func init() {
	Analyzer.Flags.IntVar(&maxLines, "max-lines", 500, "maximum physical lines per file")
}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		f := pass.Fset.File(file.Pos())
		if f == nil {
			continue
		}
		content, err := pass.ReadFile(f.Name())
		if err != nil {
			return nil, err
		}
		lines := bytes.Count(content, []byte("\n"))
		if len(content) > 0 && content[len(content)-1] != '\n' {
			lines++
		}
		if lines > maxLines {
			pass.Reportf(file.Package, "file has %d lines, exceeding max-lines=%d", lines, maxLines)
		}
	}
	return nil, nil
}
