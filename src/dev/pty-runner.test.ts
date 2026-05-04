import { describe, expect, test } from "bun:test";

import {
  defaultPtyTimeoutMs,
  defaultPtyExitTimeoutMs,
  createNodePtySpawn,
  runPtyScript,
  type PtyProcess,
  type PtySpawn,
} from "./pty-runner.ts";

async function expectRejectsWithExactMessage(action: Promise<unknown>, expectedMessage: string): Promise<void> {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(expectedMessage);
}

class FakePty implements PtyProcess {
  readonly writes: string[] = [];
  killed = false;
  private dataListeners: Array<(chunk: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number }) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }

  kill(): void {
    this.killed = true;
  }

  emitData(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) listener({ exitCode });
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

function fakeSpawner(pty: FakePty): { spawnPty: PtySpawn; calls: Array<{ command: string; args: string[]; cwd: string }> } {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  return {
    calls,
    spawnPty: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return pty;
    },
  };
}

describe("runPtyScript", () => {
  test("waits for each expected substring before writing the configured send", async () => {
    const pty = new FakePty();
    const { spawnPty, calls } = fakeSpawner(pty);

    const running = runPtyScript({
      command: "anvil",
      args: ["init", "--lang", "typescript"],
      cwd: "/workspace/project",
      env: { ANVIL_LOG_LEVEL: "error" },
      script: [
        { expect: "Project name", send: "interactive-greenfield\r" },
        { expect: "Default branch", send: "main\r" },
        { expect: "Which package manager do you use?", send: "\r" },
        { expect: "Scaffold typescript project", send: "y\r" },
        { expect_exit: 0 },
      ],
      spawnPty,
      timeoutMs: 50,
    });

    expect(calls).toEqual([{ command: "anvil", args: ["init", "--lang", "typescript"], cwd: "/workspace/project" }]);
    expect(pty.writes).toEqual([]);

    pty.emitData("Welcome\n");
    await Promise.resolve();
    expect(pty.writes).toEqual([]);

    pty.emitData("? Project name");
    await Promise.resolve();
    expect(pty.writes).toEqual(["interactive-greenfield\r"]);

    pty.emitData("\n? Default branch");
    await Promise.resolve();
    expect(pty.writes).toEqual(["interactive-greenfield\r", "main\r"]);

    pty.emitData("\n? Which package manager do you use?");
    await Promise.resolve();
    expect(pty.writes).toEqual(["interactive-greenfield\r", "main\r", "\r"]);

    pty.emitData('\n? Scaffold typescript project "interactive-greenfield" in /workspace/project?');
    await Promise.resolve();
    expect(pty.writes).toEqual(["interactive-greenfield\r", "main\r", "\r", "y\r"]);

    pty.emitData("\nScaffold complete\n");
    pty.emitExit(0);

    const result = await running;
    expect(result).toMatchObject({
      exit_code: 0,
      stdout: expect.stringContaining("Scaffold complete"),
      stderr: "",
    });
  });

  test("returns combined PTY output as stdout and empty stderr when expect_exit matches", async () => {
    const pty = new FakePty();
    const { spawnPty } = fakeSpawner(pty);

    const running = runPtyScript({
      command: "anvil",
      args: ["--version"],
      cwd: "/workspace/project",
      env: {},
      script: [{ expect_exit: 0 }],
      spawnPty,
      timeoutMs: 50,
    });

    pty.emitData("stdout and stderr share the PTY stream\n");
    pty.emitExit(0);

    await expect(running).resolves.toEqual({
      exit_code: 0,
      stdout: "stdout and stderr share the PTY stream\n",
      stderr: "",
    });
  });

  test("rejects timeout with the expected prompt and last 200 output characters", async () => {
    const pty = new FakePty();
    const { spawnPty } = fakeSpawner(pty);
    const longOutput = `${"x".repeat(220)}tail`;

    const running = runPtyScript({
      command: "anvil",
      args: ["init"],
      cwd: "/workspace/project",
      env: {},
      script: [{ expect: "ready>", send: "go\r" }, { expect_exit: 0 }],
      spawnPty,
      timeoutMs: 1,
    });

    pty.emitData(longOutput);

    await expectRejectsWithExactMessage(
      running,
      `scenario timed out waiting for: 'ready>'; saw: '${longOutput.slice(-200)}'`,
    );
  });

  test("uses the longer exit timeout after prompts have completed", async () => {
    const timeoutMs = 5;
    const pty = new FakePty();
    const { spawnPty } = fakeSpawner(pty);

    const running = runPtyScript({
      command: "anvil",
      args: ["init"],
      cwd: "/workspace/project",
      env: {},
      script: [{ expect: "confirm?", send: "y\r" }, { expect_exit: 0 }],
      spawnPty,
      timeoutMs,
      exitTimeoutMs: 100,
    });
    const observed = running.then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );

    pty.emitData("confirm?");
    await Promise.resolve();
    expect(pty.writes).toEqual(["y\r"]);

    await new Promise((resolve) => setTimeout(resolve, timeoutMs * 4));
    pty.emitExit(0);

    const outcome = await observed;
    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toMatchObject({ exit_code: 0, stdout: "confirm?", stderr: "" });
  });

  test("rejects clearly when expect_exit observes a different exit code", async () => {
    const pty = new FakePty();
    const { spawnPty } = fakeSpawner(pty);

    const running = runPtyScript({
      command: "anvil",
      args: ["init"],
      cwd: "/workspace/project",
      env: {},
      script: [{ expect_exit: 0 }],
      spawnPty,
      timeoutMs: 50,
    });

    pty.emitData("fatal: no\n");
    pty.emitExit(2);

    await expect(running).rejects.toThrow("pty expected exit code 0, got 2");
  });

  test("rejects when the process exits before an expected prompt appears", async () => {
    const pty = new FakePty();
    const { spawnPty } = fakeSpawner(pty);

    const running = runPtyScript({
      command: "anvil",
      args: ["init"],
      cwd: "/workspace/project",
      env: {},
      script: [{ expect: "Project name", send: "demo\r" }, { expect_exit: 0 }],
      spawnPty,
      timeoutMs: 50,
    });

    pty.emitData("fatal startup failure\n");
    pty.emitExit(1);

    await expect(running).rejects.toThrow(
      "pty exited before 'Project name' appeared with code 1; saw: 'fatal startup failure\n'",
    );
  });

  test("rejects scripts that do not end with expect_exit before spawning", async () => {
    const pty = new FakePty();
    const { spawnPty, calls } = fakeSpawner(pty);

    await expect(
      runPtyScript({
        command: "anvil",
        args: ["init"],
        cwd: "/workspace/project",
        env: {},
        script: [{ expect: "Project name", send: "demo\r" }],
        spawnPty,
      }),
    ).rejects.toThrow("pty script must end with expect_exit");

    expect(calls).toEqual([]);
  });

  test("kills the PTY when process errors occur before exit", async () => {
    const pty = new FakePty();
    const { spawnPty } = fakeSpawner(pty);

    const running = runPtyScript({
      command: "anvil",
      args: ["init"],
      cwd: "/workspace/project",
      env: {},
      script: [{ expect_exit: 0 }],
      spawnPty,
      timeoutMs: 50,
    });

    pty.emitError(new Error("node-pty bridge failed"));

    await expect(running).rejects.toThrow("node-pty bridge failed");
    expect(pty.killed).toBe(true);
  });

  test("creates a default spawn adapter that delegates to a node-pty compatible module", () => {
    const pty = new FakePty();
    const calls: Array<{ command: string; args: string[]; cwd: string; env?: Record<string, string> }> = [];
    const nodePty = {
      spawn: (command: string, args: string[], options: { cwd: string; env?: Record<string, string> }) => {
        calls.push({ command, args, cwd: options.cwd, env: options.env });
        return pty;
      },
    };

    const spawnPty = createNodePtySpawn(nodePty);
    const spawned = spawnPty("anvil", ["init"], { cwd: "/workspace/project", env: { CI: "1" } });

    expect(spawned).toBe(pty);
    expect(calls).toEqual([
      {
        command: "anvil",
        args: ["init"],
        cwd: "/workspace/project",
        env: { CI: "1" },
      },
    ]);
  });

  test("exports prompt and exit timeouts that allow slower post-confirm scaffolds", () => {
    expect(defaultPtyTimeoutMs).toBe(5_000);
    expect(defaultPtyExitTimeoutMs).toBe(30_000);
    expect(defaultPtyExitTimeoutMs).toBeGreaterThan(defaultPtyTimeoutMs);
  });
});
