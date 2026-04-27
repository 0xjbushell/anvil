package structuredlog

import (
	"fmt"
	"log"
	"log/slog"
)

type logger struct{}

func (logger) Info(string, ...any)  {}
func (logger) Error(string, ...any) {}

type service struct {
	logger logger
}

func InvalidFmt(name string) {
	fmt.Println(name) // want "structured logger"
}

func InvalidLog(name string) {
	log.Fatal(name) // want "structured logger"
}

func InvalidBuiltinPrint(name string) {
	println(name) // want "structured logger"
}

func InvalidConcat(l logger, name string) {
	l.Info("user " + name) // want "must not use string formatting"
}

func InvalidSprintf(l logger, name string) {
	l.Error(fmt.Sprintf("user %s", name)) // want "must not use string formatting"
}

func InvalidSecondArgFormatting(l logger, name string) {
	l.Info("user login", "message", "user "+name) // want "must not use string formatting"
}

func InvalidSecondArgSprintf(l logger, name string) {
	l.Info("user login", "message", fmt.Sprintf("user %s", name)) // want "must not use string formatting"
}

func InvalidFieldLoggerFormatting(s service, name string) {
	s.logger.Info("user " + name) // want "must not use string formatting"
}

func ValidSlog(name string) {
	slog.Info("user login", "name", name)
}

func ValidLogger(l logger, name string) {
	l.Info("user login", "name", name)
}

func ValidFormattingOutsideLog(name string) string {
	return fmt.Sprintf("user %s", name)
}

func ValidIntegerAddition(l logger, count int) {
	l.Info("count", "total", count+1)
}

func ValidErrorConstruction(err error) error {
	return fmt.Errorf("wrap: %w", err)
}
