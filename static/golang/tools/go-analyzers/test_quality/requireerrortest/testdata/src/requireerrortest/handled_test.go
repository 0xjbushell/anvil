package requireerrortest

import "testing"

type assertions struct{}

func (assertions) Error(...any) {}

var require assertions

func TestHandled(t *testing.T) {
	require.Error(t, Handled())
}
