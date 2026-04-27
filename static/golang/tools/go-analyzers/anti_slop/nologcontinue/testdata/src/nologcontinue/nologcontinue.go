package nologcontinue

import (
	"errors"
	"log"
)

func work() error { return errors.New("boom") }

func InvalidErrName() {
	if problem := work(); problem != nil { // want "error check only logs"
		log.Printf("failed: %v", problem)
	}
}

func InvalidMultipleLogs() {
	if e := work(); e != nil { // want "error check only logs"
		log.Println(e)
		log.Printf("again: %v", e)
	}
}

func InvalidCustomLogger(logger interface{ Error(string, ...any) }) {
	if e := work(); e != nil { // want "error check only logs"
		logger.Error("failed", e)
	}
}

func ValidReturn() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}

func ValidRecovery() {
	if e := work(); e != nil {
		log.Print(e)
		recoverNow()
	}
}

func ValidNonError(ok bool) {
	if ok != false {
		log.Print("ok")
	}
}

func recoverNow() {}
