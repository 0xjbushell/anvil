package nosilenterrorswallow

import "errors"

func work() error { return errors.New("boom") }
func pair() (int, error) {
	return 0, errors.New("boom")
}

func InvalidEmpty() {
	if e := work(); e != nil { // want "silently swallowed"
	}
}

func InvalidContinue(items []int) {
	for range items {
		if e := work(); e != nil { // want "silently swallowed"
			continue
		}
	}
}

func InvalidBreak(items []int) {
	for range items {
		if e := work(); e != nil { // want "silently swallowed"
			break
		}
	}
}

func InvalidDiscard() {
	_ = work() // want "silently swallowed"
}

func InvalidDiscardTuple() {
	_, _ = pair() // want "silently swallowed"
}

func ValidComment() {
	if e := work(); e != nil {
		// intentionally ignored during best-effort cleanup
	}
}

func ValidDiscardComment() {
	// intentionally ignored during best-effort cleanup
	_ = work()
}

func ValidReturn() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}

func ValidNonError(ok bool) {
	if ok != false {
	}
}
