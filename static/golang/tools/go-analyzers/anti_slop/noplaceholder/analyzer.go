package noplaceholder

import (
	"regexp"
	"strings"

	"golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{Name: "noplaceholder", Doc: "reports vague placeholder comments without tracking references", Run: run}

var (
	placeholderPattern = regexp.MustCompile(`(?i)\b(todo|fixme|placeholder|fill\s*in|hack|temporary|implement\s+(?:later|this|here)|add\s+(?:error\s+)?handling|stub)\b`)
	trackingPattern    = regexp.MustCompile(`(?i)(TIX-\d+|[A-Z][A-Z0-9]+-\d+|#[0-9]+|https?://)`)
)

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		for _, group := range file.Comments {
			for _, comment := range group.List {
				text := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(comment.Text, "//"), "/*"))
				lower := strings.ToLower(text)
				if !placeholderPattern.MatchString(text) || trackingPattern.MatchString(text) {
					continue
				}
				if strings.Contains(lower, "temporary file") || strings.Contains(lower, "temporary directory") || strings.Contains(lower, "temporary dir") || strings.Contains(lower, "hackathon") {
					continue
				}
				pass.Reportf(comment.Pos(), "placeholder comment needs a tracking reference or should be removed")
			}
		}
	}
	return nil, nil
}
