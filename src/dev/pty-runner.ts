import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export const defaultPtyTimeoutMs = 5_000;
export const defaultPtyExitTimeoutMs = defaultPtyTimeoutMs;

export interface PtyProcessResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

interface PtyDisposable {
  dispose(): void;
}

export interface PtyProcess {
  write(data: string): void;
  onData(listener: (chunk: string) => void): PtyDisposable | void;
  onExit(listener: (event: { exitCode: number }) => void): PtyDisposable | void;
  onError?(listener: (error: Error) => void): PtyDisposable | void;
  kill?(signal?: string): void;
}

export interface PtySpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export type PtySpawn = (command: string, args: string[], options: PtySpawnOptions) => PtyProcess;

export type PtyScriptStep = { expect: string; send: string } | { expect_exit: number };

export interface RunPtyScriptRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  script: PtyScriptStep[];
  spawnPty?: PtySpawn;
  timeoutMs?: number;
  exitTimeoutMs?: number;
}

interface NodePtyModule {
  spawn(command: string, args: string[], options: PtySpawnOptions): PtyProcess;
}

const require = createRequire(import.meta.url);
const bridgeScript = path.join(import.meta.dir, "node-pty-bridge.cjs");

function dispose(listener: PtyDisposable | void): void {
  if (listener !== undefined) listener.dispose();
}

export function createNodePtySpawn(pty: NodePtyModule = require("node-pty") as NodePtyModule): PtySpawn {
  return (command, args, options) => pty.spawn(command, args, options);
}

function nodeExecutable(): string {
  return process.env.ANVIL_NODE_EXECUTABLE ?? "node";
}

function sendBridgeMessage(child: ChildProcessWithoutNullStreams, message: object): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

class BridgePtyProcess implements PtyProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number }) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private stdoutBuffer = "";
  private stderr = "";
  private closed = false;
  private sawPtyExit = false;

  constructor(command: string, args: string[], options: PtySpawnOptions) {
    this.child = spawnProcess(nodeExecutable(), [bridgeScript], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.readStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => this.emitError(error));
    this.child.on("close", (code) => {
      this.closed = true;
      if (!this.sawPtyExit) {
        const details = this.stderr.trim();
        const suffix = details.length > 0 ? `: ${details}` : "";
        this.emitError(new Error(`node-pty bridge exited before PTY exit (code ${code ?? "unknown"})${suffix}`));
      }
    });

    sendBridgeMessage(this.child, {
      type: "spawn",
      command,
      args,
      cwd: options.cwd,
      env: options.env,
    });
  }

  write(data: string): void {
    this.send({ type: "write", data });
  }

  onData(listener: (chunk: string) => void): PtyDisposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: { exitCode: number }) => void): PtyDisposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  onError(listener: (error: Error) => void): PtyDisposable {
    this.errorListeners.add(listener);
    return { dispose: () => this.errorListeners.delete(listener) };
  }

  kill(signal?: string): void {
    if (!this.closed) this.send({ type: "kill", signal });
  }

  private send(message: object): void {
    if (this.closed || this.child.stdin.destroyed) {
      throw new Error("node-pty bridge is not running");
    }

    sendBridgeMessage(this.child, message);
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) return;

      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length === 0) continue;

      this.handleBridgeLine(line);
    }
  }

  private handleBridgeLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emitError(new Error(`node-pty bridge returned invalid JSON: ${(error as Error).message}`));
      return;
    }

    if (!isBridgeMessage(message)) {
      this.emitError(new Error("node-pty bridge returned an invalid protocol message"));
      return;
    }

    if (message.type === "data") {
      for (const listener of this.dataListeners) listener(message.data);
      return;
    }

    if (message.type === "exit") {
      this.sawPtyExit = true;
      for (const listener of this.exitListeners) listener({ exitCode: message.exitCode });
      return;
    }

    this.emitError(new Error(message.message));
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

type BridgeMessage =
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number }
  | { type: "error"; message: string };

function isBridgeMessage(message: unknown): message is BridgeMessage {
  if (typeof message !== "object" || message === null || !("type" in message)) return false;
  const typed = message as { type: unknown; data?: unknown; exitCode?: unknown; message?: unknown };
  return (
    (typed.type === "data" && typeof typed.data === "string") ||
    (typed.type === "exit" && typeof typed.exitCode === "number") ||
    (typed.type === "error" && typeof typed.message === "string")
  );
}

export function createNodePtyBridgeSpawn(): PtySpawn {
  return (command, args, options) => new BridgePtyProcess(command, args, options);
}

function createDefaultPtySpawn(): PtySpawn {
  return "bun" in process.versions ? createNodePtyBridgeSpawn() : createNodePtySpawn();
}

export async function runPtyScript(request: RunPtyScriptRequest): Promise<PtyProcessResult> {
  const finalStep = request.script.at(-1);
  if (finalStep === undefined || !("expect_exit" in finalStep)) {
    throw new Error("pty script must end with expect_exit");
  }

  const timeoutMs = request.timeoutMs ?? defaultPtyTimeoutMs;
  const exitTimeoutMs = request.exitTimeoutMs ?? defaultPtyExitTimeoutMs;
  const spawnPty = request.spawnPty ?? createDefaultPtySpawn();
  const pty = spawnPty(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
  });

  let output = "";
  let exitCode: number | undefined;
  let processError: Error | undefined;
  const dataWaiters = new Set<() => void>();
  const exitWaiters = new Set<() => void>();
  const errorWaiters = new Set<() => void>();
  const subscriptions = [
    pty.onData((chunk) => {
      output += chunk;
      for (const waiter of dataWaiters) waiter();
    }),
    pty.onExit((event) => {
      exitCode = event.exitCode;
      for (const waiter of exitWaiters) waiter();
    }),
    pty.onError?.((error) => {
      processError = error;
      for (const waiter of errorWaiters) waiter();
    }),
  ];

  function waitForOutput(expect: string): Promise<void> {
    if (output.includes(expect)) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = (): void => {
        clearTimeout(timer);
        dataWaiters.delete(check);
        exitWaiters.delete(check);
        errorWaiters.delete(check);
      };
      const check = (): void => {
        if (output.includes(expect)) {
          cleanup();
          resolve();
          return;
        }

        if (processError !== undefined) {
          cleanup();
          reject(processError);
          return;
        }

        if (exitCode !== undefined) {
          cleanup();
          reject(new Error(`pty exited before '${expect}' appeared with code ${exitCode}; saw: '${output.slice(-200)}'`));
        }
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`scenario timed out waiting for: '${expect}'; saw: '${output.slice(-200)}'`));
      }, timeoutMs);

      dataWaiters.add(check);
      exitWaiters.add(check);
      errorWaiters.add(check);
    });
  }

  function waitForExit(expectedExitCode: number): Promise<void> {
    if (processError !== undefined) return Promise.reject(processError);

    if (exitCode !== undefined) {
      if (exitCode !== expectedExitCode) {
        return Promise.reject(new Error(`pty expected exit code ${expectedExitCode}, got ${exitCode}`));
      }

      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = (): void => {
        clearTimeout(timer);
        exitWaiters.delete(check);
        errorWaiters.delete(check);
      };
      const check = (): void => {
        if (processError !== undefined) {
          cleanup();
          reject(processError);
          return;
        }

        if (exitCode === undefined) return;
        cleanup();

        if (exitCode !== expectedExitCode) {
          reject(new Error(`pty expected exit code ${expectedExitCode}, got ${exitCode}`));
          return;
        }

        resolve();
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`scenario timed out waiting for: 'exit ${expectedExitCode}'; saw: '${output.slice(-200)}'`));
      }, exitTimeoutMs);

      exitWaiters.add(check);
      errorWaiters.add(check);
    });
  }

  try {
    for (const step of request.script) {
      if ("expect" in step) {
        await waitForOutput(step.expect);
        pty.write(step.send);
      } else {
        await waitForExit(step.expect_exit);
      }
    }

    return {
      exit_code: exitCode ?? 0,
      stdout: output,
      stderr: "",
    };
  } catch (error) {
    if (exitCode === undefined) {
      pty.kill?.();
    }

    throw error;
  } finally {
    dataWaiters.clear();
    exitWaiters.clear();
    errorWaiters.clear();
    for (const subscription of subscriptions) dispose(subscription);
  }
}
