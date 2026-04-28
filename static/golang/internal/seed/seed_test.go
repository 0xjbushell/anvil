package seed

import (
	"errors"
	"strings"
	"testing"
)

func TestGreetSuccess(t *testing.T) {
	tests := []struct {
		name         string
		inputName    string
		language     Language
		wantGreeting string
	}{
		{name: "should greet in English", inputName: "World", language: LangEnglish, wantGreeting: "Hello, World!"},
		{name: "should greet in Spanish", inputName: "Mundo", language: LangSpanish, wantGreeting: "¡Hola, Mundo!"},
		{name: "should trim whitespace and greet in French", inputName: "  Alice  ", language: LangFrench, wantGreeting: "Bonjour, Alice!"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := Greet(tt.inputName, tt.language)
			if err != nil {
				t.Fatalf("Greet returned unexpected error: %v", err)
			}
			if result.Greeting != tt.wantGreeting {
				t.Fatalf("Greeting = %q, want %q", result.Greeting, tt.wantGreeting)
			}
			if result.Language != tt.language {
				t.Fatalf("Language = %v, want %v", result.Language, tt.language)
			}
		})
	}
}

func TestGreetValidation(t *testing.T) {
	tests := []struct {
		name      string
		inputName string
	}{
		{name: "should reject empty name", inputName: "   "},
		{name: "should reject name exceeding max length", inputName: strings.Repeat("a", MaxNameLength+1)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Greet(tt.inputName, LangEnglish)
			var seedErr *SeedError
			if !errors.As(err, &seedErr) {
				t.Fatalf("error = %v, want SeedError", err)
			}
			if seedErr.Field != "name" {
				t.Fatalf("Field = %q, want name", seedErr.Field)
			}
		})
	}
}
