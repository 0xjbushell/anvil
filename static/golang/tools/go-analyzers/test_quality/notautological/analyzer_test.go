package notautological_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/test_quality/notautological"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), notautological.Analyzer, "notautological")
}
