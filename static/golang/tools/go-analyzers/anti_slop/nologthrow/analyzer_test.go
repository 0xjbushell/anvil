package nologthrow_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/nologthrow"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), nologthrow.Analyzer, "nologthrow")
}
