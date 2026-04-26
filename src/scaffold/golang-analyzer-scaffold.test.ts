import ejs from "ejs";
import { describe, expect, test } from "bun:test";

import { getManifest } from "../manifest.ts";

const analyzerRoot = new URL("../../static/golang/tools/go-analyzers/", import.meta.url);

function analyzerFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, analyzerRoot));
}

describe("Go analyzer scaffold", () => {
  test("ships the empty multichecker harness and package directories", async () => {
    const expectedFiles = [
      "cmd/anvil-lint/main.go",
      "anti_slop/.gitkeep",
      "structural/.gitkeep",
      "test_quality/.gitkeep",
      "testdata/.gitkeep",
      "go.mod.ejs",
      "Makefile",
    ];

    for (const file of expectedFiles) {
      expect(await analyzerFile(file).exists()).toBe(true);
    }

    expect(await analyzerFile("cmd/anvil-lint/main.go").text()).toBe(
      'package main\n\nimport "golang.org/x/tools/go/analysis/multichecker"\n\nfunc main() {\n\tmultichecker.Main()\n}\n',
    );
  });

  test("renders go.mod from the resolved Go toolchain version", async () => {
    const template = await analyzerFile("go.mod.ejs").text();
    const rendered = ejs.render(template, { toolchain: { go: "1.23" } });

    expect(template).toContain("go <%= toolchain.go %>");
    expect(template).not.toMatch(/^go\s+1\.\d+/m);
    expect(rendered).toBe(
      "module tools/go-analyzers\n\ngo 1.23\n\nrequire golang.org/x/tools v0.33.0\n",
    );
  });

  test("manifest renders analyzer go.mod from the static EJS source", () => {
    const entry = getManifest("golang").entries.find(
      (candidate) => candidate.dest === "tools/go-analyzers/go.mod",
    );

    expect(entry).toEqual({
      dest: "tools/go-analyzers/go.mod",
      src: "static/golang/tools/go-analyzers/go.mod.ejs",
      source: "template",
    });
  });

  test("Makefile builds and cleans the analyzer binary", async () => {
    expect(await analyzerFile("Makefile").text()).toBe(
      ".PHONY: build clean\n\nbuild:\n\tmkdir -p bin\n\tgo build -o bin/anvil-lint ./cmd/anvil-lint\n\nclean:\n\trm -f bin/anvil-lint\n",
    );
  });
});
