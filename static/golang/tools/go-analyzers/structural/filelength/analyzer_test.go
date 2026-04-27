package filelength_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/structural/filelength"
)

func TestAnalyzer(t *testing.T) {
	if err := filelength.Analyzer.Flags.Set("max-lines", "8"); err != nil {
		t.Fatal(err)
	}
	analysistest.Run(t, analysistest.TestData(), filelength.Analyzer, "filelength")
}
