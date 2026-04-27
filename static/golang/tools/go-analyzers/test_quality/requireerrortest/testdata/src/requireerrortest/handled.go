package requireerrortest

func Handled() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}
