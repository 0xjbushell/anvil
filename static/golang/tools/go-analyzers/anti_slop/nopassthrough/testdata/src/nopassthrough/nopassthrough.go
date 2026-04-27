package nopassthrough

func target(a int, b string) int { return a }

func Invalid(a int, b string) int { // want "pass-through wrapper"
	return target(a, b)
}

func InvalidTwo(a int, b string) int { // want "pass-through wrapper"
	return target(a, b)
}

func InvalidThree(a int, b string, c bool) int { // want "pass-through wrapper"
	return targetThree(a, b, c)
}

func ValidNoParams() int {
	return target(1, "x")
}

func ValidReordered(a int, b string) int {
	return target(btoi(b), itos(a))
}

func ValidAddsBehavior(a int, b string) int {
	c := a + 1
	return target(c, b)
}

type adapter struct{}

func (adapter) ValidMethod(a int, b string) int {
	return target(a, b)
}

func targetThree(a int, b string, c bool) int { return a }
func btoi(s string) int                       { return len(s) }
func itos(i int) string                       { return "" }
