package requireerrortest

func Missing() error {
	if e := work(); e != nil {
		return e
	}
	return nil
}
