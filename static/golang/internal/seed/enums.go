package seed

type Language int

const (
	LangEnglish Language = iota
	LangSpanish
	LangFrench
)

func (l Language) String() string {
	switch l {
	case LangEnglish:
		return "english"
	case LangSpanish:
		return "spanish"
	case LangFrench:
		return "french"
	default:
		return "unknown"
	}
}
