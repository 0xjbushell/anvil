package nodisabledtest_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/test_quality/nodisabledtest"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), nodisabledtest.Analyzer, "nodisabledtest")
}
