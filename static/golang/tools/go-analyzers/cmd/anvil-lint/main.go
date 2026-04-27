package main

import (
	"golang.org/x/tools/go/analysis/multichecker"
	"tools/go-analyzers/anti_slop/noerrorobscuring"
	"tools/go-analyzers/anti_slop/nologcontinue"
	"tools/go-analyzers/anti_slop/nologthrow"
	"tools/go-analyzers/anti_slop/nopassthrough"
	"tools/go-analyzers/anti_slop/noplaceholder"
	"tools/go-analyzers/anti_slop/nosilenterrorswallow"
	"tools/go-analyzers/anti_slop/requiretests"
	"tools/go-analyzers/anti_slop/structuredlog"
	"tools/go-analyzers/structural/filelength"
	"tools/go-analyzers/structural/noexportedfunctionexpressions"
	"tools/go-analyzers/test_quality/nodisabledtest"
	"tools/go-analyzers/test_quality/noemptytest"
	"tools/go-analyzers/test_quality/notautological"
	"tools/go-analyzers/test_quality/requireerrortest"
)

func main() {
	multichecker.Main(
		nologcontinue.Analyzer,
		noerrorobscuring.Analyzer,
		noplaceholder.Analyzer,
		nologthrow.Analyzer,
		nosilenterrorswallow.Analyzer,
		nopassthrough.Analyzer,
		structuredlog.Analyzer,
		requiretests.Analyzer,
		filelength.Analyzer,
		noexportedfunctionexpressions.Analyzer,
		noemptytest.Analyzer,
		notautological.Analyzer,
		nodisabledtest.Analyzer,
		requireerrortest.Analyzer,
	)
}
