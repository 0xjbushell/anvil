import { afterEach, describe, expect, test } from 'bun:test';
import type { InitOptions, InitResult } from './commands/init.ts';
import { createProgram } from './cli.ts';
import pkg from '../package.json' with { type: 'json' };

const initCalls: InitOptions[] = [];

function makeProgram() {
  const program = createProgram({
    init: async (options): Promise<InitResult> => {
      initCalls.push(options);
      return { exitCode: 0 };
    },
    doctor: async () => {},
  });
  const silent = { writeOut: () => {}, writeErr: () => {} };
  program.exitOverride();
  program.configureOutput(silent);
  for (const sub of program.commands) {
    sub.exitOverride();
    sub.configureOutput(silent);
  }
  return program;
}

function getInitOpts(program: ReturnType<typeof makeProgram>) {
  const initCmd = program.commands.find((c) => c.name() === 'init');
  if (!initCmd) throw new Error('init command not registered');
  return initCmd.opts();
}

describe('anvil CLI parsing', () => {
  afterEach(() => {
    initCalls.length = 0;
  });

  test('init --lang typescript extracts lang option', async () => {
    const program = makeProgram();
    await program.parseAsync(['init', '--lang', 'typescript'], { from: 'user' });
    expect(getInitOpts(program).lang).toBe('typescript');
    expect(initCalls).toEqual([{ lang: 'typescript', nonInteractive: false, dryRun: false }]);
  });

  test('init --lang golang works', async () => {
    const program = makeProgram();
    await program.parseAsync(['init', '--lang', 'golang'], { from: 'user' });
    expect(getInitOpts(program).lang).toBe('golang');
  });

  test('init --lang python works', async () => {
    const program = makeProgram();
    await program.parseAsync(['init', '--lang', 'python'], { from: 'user' });
    expect(getInitOpts(program).lang).toBe('python');
  });

  test('init --lang rust fails (invalid choice)', async () => {
    const program = makeProgram();
    let err: unknown;
    try {
      await program.parseAsync(['init', '--lang', 'rust'], { from: 'user' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect((err as { code?: string }).code).toBe('commander.invalidArgument');
  });

  test('init --lang typescript --non-interactive sets the flag (CLI-05; D-67)', async () => {
    const program = makeProgram();
    await program.parseAsync(['init', '--lang', 'typescript', '--non-interactive'], {
      from: 'user',
    });
    const opts = getInitOpts(program);
    expect(opts.lang).toBe('typescript');
    expect(opts.nonInteractive).toBe(true);
  });

  test('init --lang typescript --dry-run sets the flag (CLI-06)', async () => {
    const program = makeProgram();
    await program.parseAsync(['init', '--lang', 'typescript', '--dry-run'], {
      from: 'user',
    });
    const opts = getInitOpts(program);
    expect(opts.lang).toBe('typescript');
    expect(opts.dryRun).toBe(true);
  });

  test('--version outputs the version from package.json (CLI-07)', async () => {
    const program = makeProgram();
    let written = '';
    program.configureOutput({
      writeOut: (s) => {
        written += s;
      },
      writeErr: () => {},
    });
    let err: unknown;
    try {
      await program.parseAsync(['--version'], { from: 'user' });
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string }).code).toBe('commander.version');
    expect(written.trim()).toBe(pkg.version);
  });

  test('update command fails with unknown-command error (D-39)', async () => {
    const program = makeProgram();
    let err: unknown;
    try {
      await program.parseAsync(['update'], { from: 'user' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const code = (err as { code?: string }).code;
    expect(code).toBe('commander.unknownCommand');
  });
});
