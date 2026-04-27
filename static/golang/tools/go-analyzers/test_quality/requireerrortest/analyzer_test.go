package requireerrortest_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/test_quality/requireerrortest"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), requireerrortest.Analyzer, "requireerrortest")
}
