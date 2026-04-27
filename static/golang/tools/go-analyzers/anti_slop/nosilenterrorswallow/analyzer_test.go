package nosilenterrorswallow_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/nosilenterrorswallow"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), nosilenterrorswallow.Analyzer, "nosilenterrorswallow")
}
