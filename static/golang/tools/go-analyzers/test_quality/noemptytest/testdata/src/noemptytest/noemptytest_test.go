package noemptytest

import "testing"

type assertions struct{}

func (assertions) Equal(...any) {}

var assert assertions

func TestInvalidEmpty(t *testing.T) { // want "has no assertions"
}

func TestInvalidSetupOnly(t *testing.T) { // want "has no assertions"
	value := 1
	_ = value
}

func TestInvalidHelperOnly(t *testing.T) { // want "has no assertions"
	helper()
}

func TestInvalidCustomAssert(t *testing.T) { // want "has no assertions"
	assert.Equal(1, 1)
}

func TestValidError(t *testing.T) {
	t.Error("boom")
}

func TestValidFatal(t *testing.T) {
	t.Fatalf("boom")
}

func TestMain(m *testing.M) {
	_ = m
}

func TesthelperIgnored()            {}
func BenchmarkIgnored(b *testing.B) {}
func helper()                       {}
