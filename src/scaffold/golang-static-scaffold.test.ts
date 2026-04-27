import { describe, expect, test } from "bun:test";

const golangRoot = new URL("../../static/golang/", import.meta.url);
const golangTemplateRoot = new URL("../templates/golang/", import.meta.url);
const seedFiles = [
  "internal/seed/seed.go",
  "internal/seed/seed_test.go",
  "internal/seed/types.go",
  "internal/seed/errors.go",
  "internal/seed/constants.go",
  "internal/seed/enums.go",
];
const disposableSignals = /\b(TODO|FIXME|temporary|throwaway|disposable|starter|placeholder|stub|implement later)\b/i;

function staticFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, golangRoot));
}

function templateFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, golangTemplateRoot));
}

function functionLineCounts(source: string): number[] {
  const lines = source.split("\n");
  const counts: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^func\s/.test(lines[index])) {
      continue;
    }

    let depth = 0;
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      depth += (lines[cursor].match(/\{/g) ?? []).length;
      depth -= (lines[cursor].match(/\}/g) ?? []).length;
      if (depth === 0 && cursor > index) {
        counts.push(cursor - index + 1);
        break;
      }
    }
  }

  return counts;
}

describe("Go static scaffold", () => {
  test("seed files are compact and contain no disposability markers", async () => {
    for (const file of seedFiles) {
      const source = await staticFile(file).text();

      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(100);
      expect(source).not.toMatch(disposableSignals);
      for (const lineCount of functionLineCounts(source)) {
        expect(lineCount).toBeLessThanOrEqual(50);
      }
    }
  });

  test("seed module demonstrates structured logging without print logging", async () => {
    const seed = await staticFile("internal/seed/seed.go").text();
    const app = await templateFile("cmd/app/main.go.ejs").text();

    expect(seed).toContain('"log/slog"');
    expect(seed).toContain('slog.Info("greeting generated"');
    expect(app).toContain('"log/slog"');
    expect(`${seed}\n${app}`).not.toMatch(/\b(?:fmt|log)\.Print(?:f|ln)?\(/);
  });

  test("seed module uses canonical Go enum and typed error files", async () => {
    const enums = await staticFile("internal/seed/enums.go").text();
    const errors = await staticFile("internal/seed/errors.go").text();
    const constants = await staticFile("internal/seed/constants.go").text();
    const types = await staticFile("internal/seed/types.go").text();

    expect(enums).toContain("type Language int");
    expect(enums).toMatch(/const \(\n\tLangEnglish Language = iota\n\tLangSpanish\n\tLangFrench\n\)/);
    expect(errors).toContain("type SeedError struct");
    expect(errors).toContain("func (e *SeedError) Error() string");
    expect(constants).toContain("MaxNameLength");
    expect(constants).toContain("DefaultLanguage = LangEnglish");
    expect(types).toContain("type SeedResult struct");
  });

  test("seed tests are table-driven and cover happy, error, and edge cases", async () => {
    const source = await staticFile("internal/seed/seed_test.go").text();

    expect(source).toContain("tests := []struct");
    expect(source).toContain("should greet in English");
    expect(source).toContain("should reject empty name");
    expect(source).toContain("should reject name exceeding max length");
    expect(source).toContain("should trim whitespace and greet in French");
    expect(source).toContain("errors.As(err, &seedErr)");
    expect(source).not.toContain("t.Skip(");
  });

  test("CRAP reporter source uses coverage plus AST and the spec thresholds", async () => {
    const source = await staticFile("tools/go-analyzers/cmd/crap-report/main.go").text();

    expect(source).toContain('"go/ast"');
    expect(source).toContain('"go/parser"');
    expect(source).toContain("parseCoverageFile");
    expect(source).toContain("math.Pow(float64(complexity), 2)*math.Pow(uncovered, 3)");
    expect(source).toContain('Float64("warn-threshold", 30');
    expect(source).toContain('Float64("error-threshold", 45');
  });
});
