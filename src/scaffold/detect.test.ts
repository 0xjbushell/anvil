import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Lang, PackageManager } from "../types.ts";
import { detectProject, type DetectionResult } from "./detect.ts";

let scratch: string;

beforeEach(async () => {
  scratch = path.join(tmpdir(), `anvil-scaffold-detect-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function makeDir(relativePath: string): Promise<void> {
  await mkdir(path.join(scratch, relativePath), { recursive: true });
}

async function writeFixture(relativePath: string, content = ""): Promise<void> {
  const filePath = path.join(scratch, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function expectNoDetectedCode(lang: Lang, targetDir = scratch): Promise<void> {
  const result = await detectProject(targetDir, lang);

  expect(result.hasCode).toBe(false);
  expect(result.sourceDir).toBeUndefined();
  expect(result.packageManager).toBeUndefined();
}

function expectNoPackageManager(result: DetectionResult): void {
  expect(result.packageManager).toBeUndefined();
}

describe("detectProject TypeScript detection", () => {
  test("empty directory has no code, sourceDir, or package manager", async () => {
    await expectNoDetectedCode("typescript");
  });

  test("detects TypeScript and JavaScript files recursively", async () => {
    await writeFixture("packages/api/app.ts");

    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
    });

    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    await writeFixture("web/index.js");

    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
    });
  });

  test("ignores TypeScript and JavaScript files under node_modules", async () => {
    await writeFixture("node_modules/pkg/index.ts");
    await writeFixture("nested/node_modules/pkg/index.js");

    await expectNoDetectedCode("typescript");
  });

  test("detects source directories with src > lib > app priority", async () => {
    await makeDir("app");
    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
      sourceDir: "app",
    });

    await makeDir("lib");
    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
      sourceDir: "lib",
    });

    await makeDir("src");
    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
      sourceDir: "src",
    });
  });

  test("detects non-empty package.json dependencies and devDependencies", async () => {
    await writeFixture("package.json", JSON.stringify({ dependencies: { express: "^4.0.0" } }));
    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
    });

    await rm(scratch, { recursive: true, force: true });
    await mkdir(scratch, { recursive: true });
    await writeFixture("package.json", JSON.stringify({ devDependencies: { typescript: "^5.7.2" } }));
    expect(await detectProject(scratch, "typescript")).toEqual({
      hasCode: true,
    });
  });

  test("ignores empty, missing, and invalid package.json dependencies", async () => {
    await writeFixture("package.json", JSON.stringify({ dependencies: {}, devDependencies: {} }));
    await expectNoDetectedCode("typescript");

    await writeFixture("package.json", JSON.stringify({ dependencies: [], devDependencies: "typescript" }));
    await expectNoDetectedCode("typescript");

    await writeFixture("package.json", "{not-json");
    await expectNoDetectedCode("typescript");
  });

  test("detects package managers from lockfiles in D-29 order", async () => {
    const cases: Array<[fileName: string, packageManager: PackageManager]> = [
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
      ["package-lock.json", "npm"],
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
    ];

    for (const [fileName, packageManager] of cases) {
      await rm(scratch, { recursive: true, force: true });
      await mkdir(scratch, { recursive: true });
      await writeFixture(fileName);

      expect(await detectProject(scratch, "typescript")).toEqual({
        hasCode: false,
        packageManager,
      });
    }
  });

  test("uses lockfile precedence when multiple package manager files exist", async () => {
    await writeFixture("yarn.lock");
    await writeFixture("pnpm-lock.yaml");
    expect((await detectProject(scratch, "typescript")).packageManager).toBe("pnpm");

    await writeFixture("package-lock.json");
    expect((await detectProject(scratch, "typescript")).packageManager).toBe("npm");

    await writeFixture("bun.lockb");
    expect((await detectProject(scratch, "typescript")).packageManager).toBe("bun");
  });
});

describe("detectProject Go detection", () => {
  test("empty directory has no code, sourceDir, or package manager", async () => {
    await expectNoDetectedCode("golang");
  });

  test("detects Go files recursively", async () => {
    await writeFixture("cmd/app/main.go");

    const result = await detectProject(scratch, "golang");

    expect(result).toEqual({ hasCode: true });
    expectNoPackageManager(result);
  });

  test("ignores Go files under vendor", async () => {
    await writeFixture("vendor/example/main.go");
    await writeFixture("nested/vendor/example/main.go");

    await expectNoDetectedCode("golang");
  });

  test("detects go.mod without sourceDir or packageManager", async () => {
    await writeFixture("go.mod", "module example.com/app\n");

    const result = await detectProject(scratch, "golang");

    expect(result).toEqual({ hasCode: true });
    expectNoPackageManager(result);
  });
});

describe("detectProject Python detection", () => {
  test("empty directory has no code, sourceDir, or package manager", async () => {
    await expectNoDetectedCode("python");
  });

  test("detects Python files recursively", async () => {
    await writeFixture("packages/app/main.py");

    const result = await detectProject(scratch, "python");

    expect(result).toEqual({ hasCode: true });
    expectNoPackageManager(result);
  });

  test("detects __init__.py as Python code", async () => {
    await writeFixture("mypackage/__init__.py");

    const result = await detectProject(scratch, "python");

    expect(result).toEqual({ hasCode: true });
    expectNoPackageManager(result);
  });

  test("ignores Python files under cache and virtual environment directories", async () => {
    await writeFixture("__pycache__/cached.py");
    await writeFixture(".venv/lib/app.py");
    await writeFixture("venv/lib/app.py");
    await writeFixture("nested/__pycache__/cached.py");
    await writeFixture("nested/.venv/lib/app.py");
    await writeFixture("nested/venv/lib/app.py");

    await expectNoDetectedCode("python");
  });

  test("reports src as sourceDir when the directory exists", async () => {
    await makeDir("src");

    expect(await detectProject(scratch, "python")).toEqual({
      hasCode: false,
      sourceDir: "src",
    });

    await writeFixture("src/app.py");

    expect(await detectProject(scratch, "python")).toEqual({
      hasCode: true,
      sourceDir: "src",
    });
  });
});

describe("detectProject filesystem edge cases", () => {
  test("nonexistent directories return no code for every language", async () => {
    const missing = path.join(scratch, "missing");

    await expectNoDetectedCode("typescript", missing);
    await expectNoDetectedCode("golang", missing);
    await expectNoDetectedCode("python", missing);
  });

  test("inaccessible target directories return no code for normal permission failures", async () => {
    const restricted = path.join(scratch, "restricted");
    await mkdir(restricted);
    await chmod(restricted, 0o000);

    try {
      await expectNoDetectedCode("typescript", restricted);
      await expectNoDetectedCode("golang", restricted);
      await expectNoDetectedCode("python", restricted);
    } finally {
      await chmod(restricted, 0o700);
    }
  });
});
