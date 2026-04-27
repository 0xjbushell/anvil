package noexportedfunctionexpressions

var Invalid = func() {} // want "exported function expression"

var AlsoInvalid = func(v int) int { return v } // want "exported function expression"

var ThirdInvalid = func() string { return "x" } // want "exported function expression"

var validPrivate = func() {}

func ValidDeclaration() {}

var ValidValue = 1
