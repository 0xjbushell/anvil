package requireerrortest // want "needs a corresponding error-path test"

import "errors"

func work() error { return errors.New("boom") }

func Unhandled() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}
