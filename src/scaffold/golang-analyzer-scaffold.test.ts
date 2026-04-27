import ejs from "ejs";
import { describe, expect, test } from "bun:test";

import { getManifest } from "../manifest.ts";

const analyzerRoot = new URL("../../static/golang/tools/go-analyzers/", import.meta.url);
const expectedHarnessImports = [
  '"golang.org/x/tools/go/analysis/multichecker"',
  '"tools/go-analyzers/anti_slop/noplaceholder"',
  '"tools/go-analyzers/anti_slop/nopassthrough"',
  '"tools/go-analyzers/anti_slop/nosilenterrorswallow"',
  '"tools/go-analyzers/anti_slop/structuredlog"',
  '"tools/go-analyzers/test_quality/noemptytest"',
  '"tools/go-analyzers/test_quality/requireerrortest"',
];
const expectedHarnessAnalyzers = [
  "noplaceholder.Analyzer",
  "nopassthrough.Analyzer",
  "nosilenterrorswallow.Analyzer",
  "structuredlog.Analyzer",
  "noemptytest.Analyzer",
  "requireerrortest.Analyzer",
];

function analyzerFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, analyzerRoot));
}

describe("Go analyzer scaffold", () => {
  test("ships the multichecker harness and analyzer package directories", async () => {
    const expectedFiles = [
      "cmd/anvil-lint/main.go",
      "testdata/.gitkeep",
      "go.mod.ejs",
      "Makefile",
    ];

    for (const file of expectedFiles) {
      expect(await analyzerFile(file).exists()).toBe(true);
    }

    const harness = await analyzerFile("cmd/anvil-lint/main.go").text();

    for (const importPath of expectedHarnessImports) {
      expect(harness).toContain(importPath);
    }

    expect(harness).toContain("multichecker.Main(");
    for (const analyzer of expectedHarnessAnalyzers) {
      expect(harness).toContain(analyzer);
    }
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
