package seed

import (
	"fmt"
	"log/slog"
	"strings"
)

func Greet(name string, lang Language) (SeedResult, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" {
		return SeedResult{}, &SeedError{
			Field:   "name",
			Message: "name is required",
		}
	}

	if len(trimmedName) > MaxNameLength {
		return SeedResult{}, &SeedError{
			Field:   "name",
			Message: fmt.Sprintf("name exceeds maximum length of %d", MaxNameLength),
		}
	}

	greeting := formatGreeting(trimmedName, lang)
	slog.Info("greeting generated", "name", trimmedName, "language", lang.String())

	return SeedResult{
		Greeting: greeting,
		Language: lang,
	}, nil
}

func formatGreeting(name string, lang Language) string {
	switch lang {
	case LangEnglish:
		return fmt.Sprintf("Hello, %s!", name)
	case LangSpanish:
		return fmt.Sprintf("¡Hola, %s!", name)
	case LangFrench:
		return fmt.Sprintf("Bonjour, %s!", name)
	default:
		return fmt.Sprintf("Hello, %s!", name)
	}
}
