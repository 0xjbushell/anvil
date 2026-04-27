import { describe, expect, test } from "bun:test";

import { loadToolchainDefaults } from "../internal/toolchain-defaults.ts";
import type { AnvilLockfile } from "../types.ts";
import { resolveToolchainVersions, type Fetcher } from "./init-context.ts";
import type { CommandRunner } from "./init-post.ts";

function response(body: unknown, url: string): Response {
  return {
    ok: true,
    status: 200,
    url,
    json: async () => body,
  } as Response;
}

function unexpectedFetch(urls: string[] = []): Fetcher {
  return async (input) => {
    const url = String(input);
    urls.push(url);
    throw new Error(`unexpected fetch ${url}`);
  };
}

function localBun(version = "1.3.13", commands: string[] = []): CommandRunner {
  return async (command, args) => {
    commands.push([command, ...args].join(" "));
    if (command === "bun" && args[0] === "--version") {
      return { exitCode: 0, stdout: `${version}\n`, stderr: "" };
    }

    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };
}

function makeLockfile(): AnvilLockfile {
  return {
    version: "0.1.0",
    lang: "typescript",
    flushStatus: "complete",
    context: {
      projectName: "locked",
      packageManager: "bun",
      defaultBranch: "main",
      skipSeed: false,
      year: 2026,
    },
    toolchain: { bun: "9.9.9", node: "8.8.8" },
    files: [],
    createdAt: "2026-04-26T12:00:00.000Z",
    updatedAt: "2026-04-26T12:00:00.000Z",
  };
}

describe("init toolchain resolution", () => {
  test("reuses lockfile toolchain without probing commands or network", async () => {
    const fetchedUrls: string[] = [];
    const lockfile = makeLockfile();

    const result = await resolveToolchainVersions("typescript", lockfile, {
      runCommand: async () => {
        throw new Error("runCommand should not be called for locked toolchains");
      },
      fetch: unexpectedFetch(fetchedUrls),
    });

    expect(result).toEqual({ toolchain: { bun: "9.9.9", node: "8.8.8" }, warnings: [] });
    expect(result.toolchain).not.toBe(lockfile.toolchain);
    expect(fetchedUrls).toEqual([]);
  });

  test("resolves TypeScript from local Bun and latest Node LTS", async () => {
    const fetchedUrls: string[] = [];
    const commands: string[] = [];

    const result = await resolveToolchainVersions("typescript", null, {
      runCommand: localBun("1.3.14", commands),
      fetch: async (input) => {
        const url = String(input);
        fetchedUrls.push(url);
        if (url === "https://nodejs.org/dist/index.json") {
          return response(
            [
              { version: "v25.0.0", lts: false },
              { version: "v24.15.1", lts: "Krypton" },
            ],
            url,
          );
        }

        throw new Error(`unexpected fetch ${url}`);
      },
      anvilVersion: "0.1.0",
    });

    expect(result).toEqual({ toolchain: { bun: "1.3.14", node: "24.15.1" }, warnings: [] });
    expect(commands).toEqual(["bun --version"]);
    expect(fetchedUrls).toEqual(["https://nodejs.org/dist/index.json"]);
  });

  test("falls back with exact warning when latest Node lookup fails", async () => {
    const defaults = loadToolchainDefaults();

    const result = await resolveToolchainVersions("typescript", null, {
      runCommand: localBun(defaults.bun),
      fetch: async (input) => {
        throw new Error(`network unavailable for ${String(input)}`);
      },
      anvilVersion: "0.1.0",
    });

    expect(result.toolchain).toEqual({ bun: defaults.bun, node: defaults.node });
    expect(result.warnings).toEqual([
      `warning: could not reach nodejs.org for latest node version (network unavailable for https://nodejs.org/dist/index.json); using bundled default ${defaults.node} from anvil 0.1.0. Run online to refresh.`,
    ]);
  });

  test("falls back with exact warning when latest Node lookup returns non-OK", async () => {
    const defaults = loadToolchainDefaults();

    const result = await resolveToolchainVersions("typescript", null, {
      runCommand: localBun(defaults.bun),
      fetch: async (input) => ({
        ok: false,
        status: 503,
        url: String(input),
        json: async () => [],
      }) as Response,
      anvilVersion: "0.1.0",
    });

    expect(result.toolchain).toEqual({ bun: defaults.bun, node: defaults.node });
    expect(result.warnings).toEqual([
      `warning: could not reach nodejs.org for latest node version (nodejs.org returned HTTP 503); using bundled default ${defaults.node} from anvil 0.1.0. Run online to refresh.`,
    ]);
  });

  test("times out hung latest Node lookup and falls back to bundled defaults", async () => {
    const defaults = loadToolchainDefaults();
    let aborted = false;

    const result = await resolveToolchainVersions("typescript", null, {
      runCommand: localBun(defaults.bun),
      fetch: async (_input, init) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise<Response>(() => undefined);
      },
      fetchTimeoutMs: 1,
      anvilVersion: "0.1.0",
    });

    expect(result.toolchain).toEqual({ bun: defaults.bun, node: defaults.node });
    expect(result.warnings).toEqual([
      `warning: could not reach nodejs.org for latest node version (nodejs.org timed out after 1ms); using bundled default ${defaults.node} from anvil 0.1.0. Run online to refresh.`,
    ]);
    expect(aborted).toBe(true);
  });

  test("times out hung latest Node response body and falls back to bundled defaults", async () => {
    const defaults = loadToolchainDefaults();
    let jsonStarted = false;

    const result = await resolveToolchainVersions("typescript", null, {
      runCommand: localBun(defaults.bun),
      fetch: async (input) => {
        return {
          ok: true,
          status: 200,
          url: String(input),
          json: async () => {
            jsonStarted = true;
            return new Promise<unknown>(() => undefined);
          },
        } as Response;
      },
      fetchTimeoutMs: 1,
      anvilVersion: "0.1.0",
    });

    expect(result.toolchain).toEqual({ bun: defaults.bun, node: defaults.node });
    expect(result.warnings).toEqual([
      `warning: could not reach nodejs.org for latest node version (nodejs.org timed out after 1ms); using bundled default ${defaults.node} from anvil 0.1.0. Run online to refresh.`,
    ]);
    expect(jsonStarted).toBe(true);
  });

  test("resolves Go and Python from language-specific sources only", async () => {
    const goUrls: string[] = [];
    const pythonUrls: string[] = [];

    const go = await resolveToolchainVersions("golang", null, {
      runCommand: localBun(),
      fetch: async (input) => {
        const url = String(input);
        goUrls.push(url);
        if (url === "https://go.dev/dl/?mode=json") {
          return response([{ version: "go1.27.3" }], url);
        }

        throw new Error(`unexpected fetch ${url}`);
      },
    });
    const python = await resolveToolchainVersions("python", null, {
      runCommand: localBun(),
      fetch: async (input) => {
        const url = String(input);
        pythonUrls.push(url);
        if (url === "https://endoflife.date/api/python.json") {
          return response([{ latest: "3.15.2", eol: "2027-10-01" }], url);
        }

        throw new Error(`unexpected fetch ${url}`);
      },
      now: () => new Date("2026-04-26T12:00:00.000Z"),
    });

    expect(go).toEqual({ toolchain: { bun: "1.3.13", go: "1.27.3" }, warnings: [] });
    expect(python).toEqual({ toolchain: { bun: "1.3.13", python: "3.15.2" }, warnings: [] });
    expect(goUrls).toEqual(["https://go.dev/dl/?mode=json"]);
    expect(pythonUrls).toEqual(["https://endoflife.date/api/python.json"]);
  });

  test("falls back to bundled Bun when local and remote Bun are unavailable", async () => {
    const defaults = loadToolchainDefaults();

    const result = await resolveToolchainVersions("typescript", null, {
      runCommand: async () => ({ exitCode: 1, stdout: "", stderr: "missing" }),
      fetch: async (input) => {
        const url = String(input);
        if (url === "https://github.com/oven-sh/bun/releases/latest") {
          throw new Error("GitHub unavailable");
        }
        if (url === "https://nodejs.org/dist/index.json") {
          return response([{ version: "v24.15.1", lts: "Krypton" }], url);
        }

        throw new Error(`unexpected fetch ${url}`);
      },
      anvilVersion: "0.1.0",
    });

    expect(result.toolchain).toEqual({ bun: defaults.bun, node: "24.15.1" });
    expect(result.warnings).toEqual([
      `warning: could not reach github.com/oven-sh/bun for latest bun version (GitHub unavailable); using bundled default ${defaults.bun} from anvil 0.1.0. Run online to refresh.`,
    ]);
  });
});
