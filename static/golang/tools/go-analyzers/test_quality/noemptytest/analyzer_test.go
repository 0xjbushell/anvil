package noemptytest_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/test_quality/noemptytest"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), noemptytest.Analyzer, "noemptytest")
}
