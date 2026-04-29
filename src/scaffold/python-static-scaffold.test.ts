import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const pythonRoot = new URL("../../static/python/", import.meta.url);
const pythonSourcePath = fileURLToPath(new URL("src/", pythonRoot));
const tixStaticFiles = [
  "src/seed/__init__.py",
  "src/seed/seed.py",
  "src/seed/types.py",
  "src/seed/errors.py",
  "src/seed/constants.py",
  "src/seed/enums.py",
  "tests/conftest.py",
  "tests/test_seed.py",
  ".gitattributes",
  ".editorconfig",
  ".gitleaks.toml",
];
const seedFiles = [
  "src/seed/__init__.py",
  "src/seed/seed.py",
  "src/seed/types.py",
  "src/seed/errors.py",
  "src/seed/constants.py",
  "src/seed/enums.py",
];
const disposableSignals = /\b(TODO|FIXME|temporary|throwaway|disposable|starter|placeholder|stub|implement later)\b/i;

function staticFile(relativePath: string): Bun.BunFile {
  return Bun.file(new URL(relativePath, pythonRoot));
}

async function runPythonContract(script: string): Promise<{ exitCode: number; stderr: string }> {
  const child = Bun.spawn(["python3", "-c", script], {
    env: { ...Bun.env, PYTHONPATH: pythonSourcePath },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stderr };
}

describe("Python static scaffold", () => {
  test("TIX-000048 static files exist at their Python scaffold paths", async () => {
    for (const file of tixStaticFiles) {
      expect(await staticFile(file).exists()).toBe(true);
    }
  });

  test("seed files are compact and contain no disposability markers", async () => {
    for (const file of seedFiles) {
      const source = await staticFile(file).text();

      expect(source.trimEnd().split("\n").length).toBeLessThanOrEqual(100);
      expect(source).not.toMatch(disposableSignals);
    }
  });

  test("seed module demonstrates stdlib structured logging without print-style logging", async () => {
    const source = await staticFile("src/seed/seed.py").text();

    expect(source).toContain("import logging");
    expect(source).toMatch(/logger\s*=\s*logging\.getLogger\(__name__\)/);
    expect(source).toMatch(/logger\.info\(\s*["']greeting generated["'],\s*extra=\{/s);
    expect(source).not.toMatch(/\bprint\s*\(/);
    expect(source).not.toMatch(/logger\.(?:debug|info|warning|error|critical)\(\s*f["']/);
    expect(source).not.toMatch(/logger\.(?:debug|info|warning|error|critical)\([^\n]*(?:\+|\.format\()/);
  });

  test("package exports re-export the public seed API through __all__", async () => {
    const source = await staticFile("src/seed/__init__.py").text();

    for (const symbol of [
      "greet",
      "SeedResult",
      "SeedError",
      "MAX_NAME_LENGTH",
      "DEFAULT_LANGUAGE",
      "Language",
    ]) {
      expect(source).toMatch(new RegExp(`["']${symbol}["']`));
    }
    expect(source).toContain("__all__");
    expect(source).toMatch(/from \.seed import greet/);
    expect(source).toMatch(/from \.types import SeedResult/);
    expect(source).toMatch(/from \.errors import SeedError/);
    expect(source).toMatch(/from \.constants import (?:DEFAULT_LANGUAGE, MAX_NAME_LENGTH|MAX_NAME_LENGTH, DEFAULT_LANGUAGE)/);
    expect(source).toMatch(/from \.enums import Language/);
  });

  test("seed support modules define typed results, errors, constants, and enums", async () => {
    const types = await staticFile("src/seed/types.py").text();
    const errors = await staticFile("src/seed/errors.py").text();
    const constants = await staticFile("src/seed/constants.py").text();
    const enums = await staticFile("src/seed/enums.py").text();

    expect(types).toMatch(/class\s+SeedResult\(TypedDict\):/);
    expect(errors).toMatch(/class\s+SeedError\(Exception\):/);
    expect(constants).toMatch(/^MAX_NAME_LENGTH(?:\s*:\s*\w+)?\s*=/m);
    expect(constants).toMatch(/^DEFAULT_LANGUAGE(?:\s*:\s*\w+)?\s*=/m);
    expect(constants).not.toMatch(/^[a-z][a-z0-9_]*\s*=/m);
    expect(enums).toMatch(/class\s+Language\(Enum\):/);
    expect(enums).toMatch(/^\s+ENGLISH\s*=\s*["']English["']/m);
    expect(enums).toMatch(/^\s+SPANISH\s*=\s*["']Spanish["']/m);
    expect(enums).toMatch(/^\s+FRENCH\s*=\s*["']French["']/m);
  });

  test("seed package public API imports and executes as working Python code", async () => {
    const script = String.raw`
from seed import DEFAULT_LANGUAGE, MAX_NAME_LENGTH, Language, SeedError, greet

result = greet("Alice")
assert result == {
    "message": "Hello, Alice!",
    "name": "Alice",
    "language": DEFAULT_LANGUAGE.value,
}
assert DEFAULT_LANGUAGE is Language.ENGLISH
assert MAX_NAME_LENGTH >= len("Alice")

try:
    greet("")
except SeedError:
    pass
else:
    raise AssertionError("empty name did not raise SeedError")

try:
    greet("A" * (MAX_NAME_LENGTH + 1))
except SeedError:
    pass
else:
    raise AssertionError("overlong name did not raise SeedError")
`;
    const result = await runPythonContract(script);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("seed tests cover happy, error, boundary, and edge behavior without weak patterns", async () => {
    const source = await staticFile("tests/test_seed.py").text();

    expect(source).toContain("def test_");
    expect(source).toMatch(/assert\s+greet\([^\n]+==/);
    expect(source).toMatch(/with\s+pytest\.raises\(SeedError\):/);
    expect(source).toMatch(/MAX_NAME_LENGTH/);
    expect(source).toMatch(/empty|blank|whitespace/i);
    expect(source).not.toMatch(/^\s*pass\s*$/m);
    expect(source).not.toMatch(/pytest\.mark\.skip|\.skip\(/);
    expect(source).not.toMatch(/snapshot|snapshottest|assert_match/);
    expect(source).not.toMatch(disposableSignals);
  });
});
