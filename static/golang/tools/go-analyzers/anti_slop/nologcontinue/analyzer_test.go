package nologcontinue_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/nologcontinue"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), nologcontinue.Analyzer, "nologcontinue")
}
