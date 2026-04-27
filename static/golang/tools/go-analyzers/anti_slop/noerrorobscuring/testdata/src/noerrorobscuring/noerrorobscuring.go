package noerrorobscuring

import (
	"errors"
	"fmt"
)

func work() error { return errors.New("boom") }

func InvalidNil() error {
	if e := work(); e != nil {
		return nil // want "without propagating"
	}
	return nil
}

func InvalidDefault() (int, error) {
	if problem := work(); problem != nil {
		return 0, nil // want "without propagating"
	}
	return 1, nil
}

func InvalidGeneric() error {
	if e := work(); e != nil {
		return errors.New("failed") // want "without propagating"
	}
	return nil
}

func ValidReturn() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}

func ValidWrap() error {
	if e := work(); e != nil {
		return fmt.Errorf("wrapped: %w", e)
	}
	return nil
}

func ValidNoErrorReturn() int {
	if e := work(); e != nil {
		return 0
	}
	return 1
}
