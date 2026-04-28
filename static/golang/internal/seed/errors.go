package seed

import "fmt"

type SeedError struct {
	Field   string
	Message string
}

func (e *SeedError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}
