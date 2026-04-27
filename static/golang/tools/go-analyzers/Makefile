.PHONY: build clean

build:
	mkdir -p bin
	go build -o bin/anvil-lint ./cmd/anvil-lint
	go build -o bin/crap-report ./cmd/crap-report

clean:
	rm -f bin/anvil-lint bin/crap-report
