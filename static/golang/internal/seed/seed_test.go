package seed

import (
	"errors"
	"strings"
	"testing"
)

func TestGreet(t *testing.T) {
	tests := []struct {
		name         string
		inputName    string
		language     Language
		wantGreeting string
		wantErr      bool
	}{
		{name: "should greet in English", inputName: "World", language: LangEnglish, wantGreeting: "Hello, World!"},
		{name: "should greet in Spanish", inputName: "Mundo", language: LangSpanish, wantGreeting: "¡Hola, Mundo!"},
		{name: "should trim whitespace and greet in French", inputName: "  Alice  ", language: LangFrench, wantGreeting: "Bonjour, Alice!"},
		{name: "should reject empty name", inputName: "   ", language: LangEnglish, wantErr: true},
		{name: "should reject name exceeding max length", inputName: strings.Repeat("a", MaxNameLength+1), language: LangEnglish, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Greet(tt.inputName, tt.language)
			if tt.wantErr {
				assertSeedError(t, err)
				return
			}
			assertGreeting(t, result, err, tt.wantGreeting, tt.language)
		})
	}
}

func assertGreeting(t *testing.T, result SeedResult, err error, wantGreeting string, wantLanguage Language) {
	t.Helper()
	if err != nil {
		t.Fatalf("Greet returned unexpected error: %v", err)
	}
	if result.Greeting != wantGreeting {
		t.Fatalf("Greeting = %q, want %q", result.Greeting, wantGreeting)
	}
	if result.Language != wantLanguage {
		t.Fatalf("Language = %v, want %v", result.Language, wantLanguage)
	}
}

func assertSeedError(t *testing.T, err error) {
	t.Helper()
	var seedErr *SeedError
	if !errors.As(err, &seedErr) {
		t.Fatalf("error = %v, want SeedError", err)
	}
	if seedErr.Field != "name" {
		t.Fatalf("Field = %q, want name", seedErr.Field)
	}
}
