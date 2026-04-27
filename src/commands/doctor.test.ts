import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { AnvilLockfile, Lang, PackageManager } from "../types.ts";
import { LOCKFILE_NAME, computeChecksum, writeLockfile } from "../scaffold/lockfile.ts";
import {
  checkAndFix,
  checkAudit,
  checkConfigs,
  checkLockfile,
  checkTools,
  runDoctor,
  type DoctorDependencies,
  type DoctorCheck,
} from "./doctor.ts";
import type { RunCommandResult } from "./init-post.ts";

class StringWriter {
  text = "";

  write(chunk: string): void {
    this.text += chunk;
  }
}

const tsProjectDeps = ["eslint", "prettier", "vitest", "knip", "typescript", "better-npm-audit"];
const pythonProjectDeps = ["flake8", "mypy", "pytest", "pip-audit"];
const goProjectDeps = ["golang.org/x/tools/cmd/deadcode", "golang.org/x/vuln/cmd/govulncheck"];

let scratch: string;

beforeEach(async () => {
  scratch = path.join(tmpdir(), `anvil-doctor-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function commandResult(overrides: Partial<RunCommandResult> = {}): RunCommandResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function makeLockfile(overrides: Partial<AnvilLockfile> = {}): AnvilLockfile {
  const timestamp = "2026-04-27T12:00:00.000Z";
  return {
    version: "0.1.0",
    lang: "typescript",
    flushStatus: "complete",
    context: {
      projectName: "doctor-fixture",
      packageManager: "bun",
      defaultBranch: "main",
      sourceDir: "src",
      skipSeed: false,
      year: 2026,
    },
    toolchain: {
      bun: "1.3.13",
      node: "24.15.0",
    },
    files: [
      {
        path: "README.md",
        checksum: computeChecksum("readme\n"),
        status: "written",
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

async function writeText(relativePath: string, contents: string): Promise<void> {
  const filePath = path.join(scratch, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function writeGoodTypescriptConfigs(): Promise<void> {
  await Promise.all([
    writeText("eslint.config.mjs", "export default [];\n"),
    writeText("tsconfig.json", "{}\n"),
    writeText("package.json", JSON.stringify({ type: "module" }, null, 2) + "\n"),
    writeText("Makefile", "lint:\n\ntest:\n\ncheck:\n\nformat:\n"),
    writeText(".pre-commit-config.yaml", "repos: []\n"),
    writeText(".gitignore", "node_modules/\ndist/\ncoverage/\n.stryker-tmp/\n.env\n.DS_Store\n"),
    writeText(".gitattributes", "* text=auto eol=lf\n"),
    writeText("README.md", "readme\n"),
  ]);
  await writeLockfile(scratch, makeLockfile());
}

function okDoctorDeps(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  const stdout = new StringWriter();
  const stderr = new StringWriter();
  return {
    cwd: () => scratch,
    stdout,
    stderr,
    anvilVersion: "0.1.0",
    runCommand: async (command, args) => {
      if (command === "bun" && args[0] === "pm" && args[1] === "ls") {
        return commandResult({ stdout: tsProjectDeps.join("\n") });
      }

      if (command === "go" && args.join(" ") === "list -m all") {
        return commandResult({ stdout: goProjectDeps.join("\n") });
      }

      if (command === "uv" && args.join(" ") === "pip list --format=json") {
        return commandResult({
          stdout: JSON.stringify(pythonProjectDeps.map((name) => ({ name }))),
        });
      }

      return commandResult();
    },
    ...overrides,
  };
}

function byName(checks: DoctorCheck[], name: string): DoctorCheck {
  const check = checks.find((candidate) => candidate.name === name);
  if (check === undefined) {
    throw new Error(`missing check ${name}; saw ${checks.map((candidate) => candidate.name).join(", ")}`);
  }
  return check;
}

describe("anvil doctor command", () => {
  test("missing lockfile is a warning with init guidance", async () => {
    const checks = await checkLockfile(scratch, okDoctorDeps());

    expect(byName(checks, ".anvil.lock").status).toBe("warn");
    expect(byName(checks, ".anvil.lock").message).toContain("not found");
    expect(byName(checks, ".anvil.lock").instruction).toContain("anvil init");
  });

  test("all TypeScript tools and project deps pass when probes succeed", async () => {
    const checks = await checkTools("typescript", scratch, okDoctorDeps(), "bun");

    expect(checks.every((check) => check.status === "pass")).toBe(true);
    for (const dep of tsProjectDeps) {
      expect(byName(checks, `typescript dependency: ${dep}`).status).toBe("pass");
    }
  });

  test("missing required tool fails with manual install instruction", async () => {
    const checks = await checkTools(
      "typescript",
      scratch,
      okDoctorDeps({
        runCommand: async (_command, args) => {
          if (args[0] === "pre-commit") {
            return commandResult({ exitCode: 1 });
          }

          return commandResult({ stdout: tsProjectDeps.join("\n") });
        },
      }),
      "bun",
    );

    const check = byName(checks, "tool: pre-commit");
    expect(check.status).toBe("fail");
    expect(check.instruction).toContain("pre-commit");
  });

  test("global tool checks include git", async () => {
    const checks = await checkTools(
      "typescript",
      scratch,
      okDoctorDeps({
        runCommand: async (_command, args) => {
          if (args[0] === "git") {
            return commandResult({ exitCode: 1 });
          }

          return commandResult({ stdout: tsProjectDeps.map((dep) => `${dep}@1.0.0`).join("\n") });
        },
      }),
      "bun",
    );

    const check = byName(checks, "tool: git");
    expect(check.status).toBe("fail");
    expect(check.instruction).toContain("Git");
  });

  test("TypeScript dependency checks require exact package names", async () => {
    const checks = await checkTools(
      "typescript",
      scratch,
      okDoctorDeps({
        runCommand: async (command, args) => {
          if (command === "bun" && args[0] === "pm" && args[1] === "ls") {
            return commandResult({
              stdout: [
                "├── @typescript-eslint/parser@8.59.0",
                "├── eslint-config-custom@1.0.0",
                "├── prettier@3.0.0",
                "├── vitest@3.0.0",
                "├── knip@5.0.0",
                "└── better-npm-audit-extra@1.0.0",
              ].join("\n"),
            });
          }

          return commandResult();
        },
      }),
      "bun",
    );

    expect(byName(checks, "typescript dependency: eslint").status).toBe("fail");
    expect(byName(checks, "typescript dependency: typescript").status).toBe("fail");
    expect(byName(checks, "typescript dependency: better-npm-audit").status).toBe("fail");
    expect(byName(checks, "typescript dependency: prettier").status).toBe("pass");
  });

  test("Python tool check accepts python fallback when python3 is missing", async () => {
    const checks = await checkTools(
      "python",
      scratch,
      okDoctorDeps({
        runCommand: async (command, args) => {
          if (command === "which" && args[0] === "python3") {
            return commandResult({ exitCode: 1 });
          }

          return okDoctorDeps().runCommand!(command, args, { cwd: scratch });
        },
      }),
    );

    const check = byName(checks, "tool: python");
    expect(check.status).toBe("pass");
    expect(check.message).toContain("python");
  });

  test("valid TypeScript config files pass", async () => {
    await writeGoodTypescriptConfigs();

    const checks = await checkConfigs("typescript", scratch);

    expect(checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(byName(checks, "eslint.config.mjs").status).toBe("pass");
    expect(byName(checks, ".pre-commit-config.yaml syntax").status).toBe("pass");
    expect(byName(checks, ".gitattributes").status).toBe("pass");
  });

  test("missing or incomplete gitattributes warns about LF enforcement", async () => {
    await writeGoodTypescriptConfigs();
    await rm(path.join(scratch, ".gitattributes"), { force: true });

    let checks = await checkConfigs("typescript", scratch);

    expect(byName(checks, ".gitattributes").status).toBe("warn");
    expect(byName(checks, ".gitattributes").message).toContain("LF");

    await writeText(".gitattributes", "*.ts text\n");
    checks = await checkConfigs("typescript", scratch);

    expect(byName(checks, ".gitattributes").status).toBe("warn");
  });

  test("missing required config files fail", async () => {
    const checks = await checkConfigs("golang", scratch);

    expect(byName(checks, ".golangci.yml").status).toBe("fail");
    expect(byName(checks, "go.mod").status).toBe("fail");
    expect(byName(checks, "Makefile").status).toBe("fail");
  });

  test("lockfile checksum drift is a warning", async () => {
    await writeText("README.md", "changed\n");
    await writeLockfile(scratch, makeLockfile());

    const checks = await checkLockfile(scratch, okDoctorDeps());

    const check = byName(checks, "lockfile checksum: README.md");
    expect(check.status).toBe("warn");
    expect(check.message).toContain("modified");
  });

  test("in-progress lockfile reports pending checkpoint entries as warnings", async () => {
    await writeText("README.md", "readme\n");
    await writeText("pending.txt", "pending\n");
    await writeLockfile(
      scratch,
      makeLockfile({
        flushStatus: "in-progress",
        files: [
          {
            path: "README.md",
            checksum: computeChecksum("readme\n"),
            status: "written",
          },
          {
            path: "pending.txt",
            checksum: computeChecksum("pending\n"),
            status: "pending",
          },
        ],
      }),
    );

    const checks = await checkLockfile(scratch, okDoctorDeps());
    const checkpoint = byName(checks, ".anvil.lock checkpoint");

    expect(checkpoint.status).toBe("warn");
    expect(checkpoint.message).toContain("interrupted");
    expect(checkpoint.instruction).toContain("pending.txt");
    expect(checks.some((check) => check.status === "fail")).toBe(false);
  });

  test("corrupt lockfile fails with delete and init guidance", async () => {
    await writeText(LOCKFILE_NAME, "{not-json");

    const checks = await checkLockfile(scratch, okDoctorDeps());
    const lockfile = byName(checks, ".anvil.lock");
    const text = [lockfile.message, lockfile.instruction ?? ""].join("\n");

    expect(lockfile.status).toBe("fail");
    expect(text).toContain("Delete");
    expect(text).toContain("anvil init");
    expect(text).not.toContain("anvil update");
  });

  test("gitignore auto-fix appends missing entries without removing user content", async () => {
    await writeText(".gitignore", "custom.log\nnode_modules/\n");

    const checks = await checkAndFix("typescript", scratch);
    const gitignore = await readFile(path.join(scratch, ".gitignore"), "utf8");

    expect(byName(checks, ".gitignore entries").status).toBe("fixed");
    expect(gitignore).toContain("custom.log\n");
    expect(gitignore).toContain("dist/\n");
    expect(gitignore).toContain(".env\n");
  });

  test("auto-fix appends trailing newlines to config files without changing content", async () => {
    await writeText(".gitignore", "node_modules/\ndist/\ncoverage/\n.stryker-tmp/\n.env\n.DS_Store\n");
    await writeText("Makefile", "lint:");
    await writeText("eslint.config.mjs", "export default [];");

    const checks = await checkAndFix("typescript", scratch);

    expect(byName(checks, "trailing newline: Makefile").status).toBe("fixed");
    expect(byName(checks, "trailing newline: eslint.config.mjs").status).toBe("fixed");
    expect(await readFile(path.join(scratch, "Makefile"), "utf8")).toBe("lint:\n");
    expect(await readFile(path.join(scratch, "eslint.config.mjs"), "utf8")).toBe("export default [];\n");

    const secondPass = await checkAndFix("typescript", scratch);
    expect(byName(secondPass, "trailing newline: Makefile").status).toBe("pass");
    expect(await readFile(path.join(scratch, "Makefile"), "utf8")).toBe("lint:\n");
  });

  test("TypeScript tool checks do not run Go or Python probes", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    await checkTools(
      "typescript",
      scratch,
      okDoctorDeps({
        runCommand: async (command, args) => {
          calls.push({ command, args });
          return commandResult({ stdout: tsProjectDeps.join("\n") });
        },
      }),
      "bun",
    );

    expect(calls.some((call) => call.command === "go")).toBe(false);
    expect(calls.some((call) => call.command === "python" || call.command === "python3" || call.command === "uv")).toBe(false);
  });

  test("runDoctor exits 0 when no failures are present", async () => {
    await writeGoodTypescriptConfigs();

    const result = await runDoctor(okDoctorDeps());

    expect(result.exitCode).toBe(0);
    expect(result.checks.some((check) => check.status === "fail")).toBe(false);
  });

  test("runDoctor exits 1 when any check fails", async () => {
    await writeGoodTypescriptConfigs();

    const result = await runDoctor(
      okDoctorDeps({
        runCommand: async (command, args, options) => {
          if (command === "which" && args[0] === "gitleaks") {
            return commandResult({ exitCode: 1 });
          }

          return okDoctorDeps().runCommand!(command, args, options);
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(byName(result.checks, "tool: gitleaks").status).toBe("fail");
  });

  test("doctor guidance never mentions the deferred update command", async () => {
    await writeGoodTypescriptConfigs();
    await writeLockfile(scratch, makeLockfile({ version: "0.0.9" }));
    const stdout = new StringWriter();
    const stderr = new StringWriter();

    const result = await runDoctor(okDoctorDeps({ stdout, stderr, anvilVersion: "0.1.0" }));
    const allText = [
      stdout.text,
      stderr.text,
      ...result.checks.flatMap((check) => [check.message, check.instruction ?? "", check.fix ?? ""]),
    ].join("\n");

    expect(allText).not.toContain("anvil update");
    expect(allText).toContain("anvil init");
  });

  test("audit uses the Bun better-npm-audit command for Bun TypeScript projects", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const checks = await checkAudit(
      "typescript",
      scratch,
      okDoctorDeps({
        runCommand: async (command, args) => {
          calls.push({ command, args });
          return commandResult();
        },
      }),
      "bun",
    );

    expect(calls).toEqual([{ command: "bunx", args: ["better-npm-audit", "audit"] }]);
    expect(byName(checks, "dependency audit").status).toBe("pass");
  });

  test("language-specific project dependency checks cover Go and Python", async () => {
    await mkdir(path.join(scratch, "tools/go-analyzers/bin"), { recursive: true });
    await writeText("tools/go-analyzers/bin/anvil-lint", "");

    const goChecks = await checkTools("golang", scratch, okDoctorDeps());
    const pythonChecks = await checkTools("python", scratch, okDoctorDeps());

    expect(byName(goChecks, "golang dependency: deadcode").status).toBe("pass");
    expect(byName(goChecks, "golang dependency: govulncheck").status).toBe("pass");
    expect(byName(goChecks, "golang dependency: anvil-lint").status).toBe("pass");
    expect(byName(pythonChecks, "python dependency: flake8").status).toBe("pass");
    expect(byName(pythonChecks, "python dependency: pip-audit").status).toBe("pass");
  });
});
