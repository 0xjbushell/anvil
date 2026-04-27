package structuredlog_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/structuredlog"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), structuredlog.Analyzer, "structuredlog")
}
