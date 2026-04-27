package notautological

import "testing"

type assertions struct{}

func (assertions) Equal(...any) {}
func (assertions) True(...any)  {}
func (assertions) False(...any) {}
func (assertions) Nil(...any)   {}

var assert assertions
var require assertions

func TestInvalidEqual(t *testing.T) {
	assert.Equal(t, 1, 1) // want "identical literal"
}

func TestInvalidTrue(t *testing.T) {
	require.True(t, true) // want "tautologically true"
}

func TestInvalidNil(t *testing.T) {
	assert.Nil(t, nil) // want "nil assertion"
}

func TestValidEqual(t *testing.T) {
	assert.Equal(t, 1, 2)
}

func TestValidVariable(t *testing.T) {
	got := true
	require.True(t, got)
}

func TestValidNilVariable(t *testing.T) {
	var got any
	assert.Nil(t, got)
}
