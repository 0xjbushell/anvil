package nopassthrough_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/nopassthrough"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), nopassthrough.Analyzer, "nopassthrough")
}
