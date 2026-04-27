package noerrorobscuring_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/noerrorobscuring"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), noerrorobscuring.Analyzer, "noerrorobscuring")
}
