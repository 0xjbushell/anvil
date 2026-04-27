package noexportedfunctionexpressions_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/structural/noexportedfunctionexpressions"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), noexportedfunctionexpressions.Analyzer, "noexportedfunctionexpressions")
}
