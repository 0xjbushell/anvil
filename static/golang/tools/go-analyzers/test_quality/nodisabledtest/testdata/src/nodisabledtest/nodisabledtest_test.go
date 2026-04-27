package nodisabledtest

import "testing"

func TestInvalidSkip(t *testing.T) {
	t.Skip() // want "needs an explanation"
}

func TestInvalidSkipf(t *testing.T) {
	t.Skipf("") // want "needs an explanation"
}

func TestInvalidSkipNow(t *testing.T) {
	t.SkipNow() // want "needs an explanation"
}

func TestValidReason(t *testing.T) {
	t.Skip("external service unavailable")
}

func TestValidSkipfReason(t *testing.T) {
	t.Skipf("waiting on %s", "fixture")
}

func TestValidNoSkip(t *testing.T) {}
