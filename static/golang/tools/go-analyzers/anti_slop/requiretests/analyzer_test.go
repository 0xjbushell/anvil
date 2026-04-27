package requiretests_test

import (
	"testing"

	"golang.org/x/tools/go/analysis/analysistest"
	"tools/go-analyzers/anti_slop/requiretests"
)

func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), requiretests.Analyzer, "requiretests/internal/sample", "requiretests/cmd/app")
}
