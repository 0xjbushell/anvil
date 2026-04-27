package sample

func Covered(enabled bool) int {
	if enabled {
		return 1
	}
	return 0
}

func Uncovered(enabled bool) int {
	if enabled {
		return 1
	}
	return 0
}
