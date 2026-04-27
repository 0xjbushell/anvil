package nologthrow

import "errors"

type logger struct{}

func (logger) Error(string, ...any) {}
func (logger) Warn(string, ...any)  {}
func (logger) Debug(string, ...any) {}

func work() error { return errors.New("boom") }

func InvalidError(l logger) error {
	if e := work(); e != nil { // want "logged and returned"
		l.Error("failed", e)
		return e
	}
	return nil
}

func InvalidWarn(l logger) error {
	if problem := work(); problem != nil { // want "logged and returned"
		l.Warn("failed", problem)
		return problem
	}
	return nil
}

func InvalidWrapped(l logger) error {
	if e := work(); e != nil { // want "logged and returned"
		l.Error("failed", e)
		return wrap(e)
	}
	return nil
}

func ValidDebug(l logger) error {
	if e := work(); e != nil {
		l.Debug("failed", e)
		return e
	}
	return nil
}

func ValidLogOnly(l logger) {
	if e := work(); e != nil {
		l.Error("failed", e)
	}
}

func ValidReturnOnly() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}

func wrap(e error) error { return e }
