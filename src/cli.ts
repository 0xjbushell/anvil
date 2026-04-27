import { Command, Option } from 'commander';
import init, { type InitOptions, type InitResult } from './commands/init.ts';
import doctor from './commands/doctor.ts';
import pkg from '../package.json' with { type: 'json' };

const initLangChoices = ['golang', 'typescript', 'python'] satisfies InitOptions['lang'][];

export interface ProgramHandlers {
  init?: (options: InitOptions) => Promise<InitResult | void>;
  doctor?: () => Promise<void>;
}

function applyInitExitCode(result: InitResult | void): void {
  if (result !== undefined && result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

function isInitLang(value: unknown): value is InitOptions['lang'] {
  return typeof value === 'string' && initLangChoices.includes(value as InitOptions['lang']);
}

function readInitOptions(options: Record<string, unknown>): InitOptions {
  if (!isInitLang(options.lang)) {
    throw new Error(`Invalid init language: ${String(options.lang)}`);
  }

  return {
    lang: options.lang,
    nonInteractive: options.nonInteractive === true,
    dryRun: options.dryRun === true,
  };
}

export function createProgram(handlers: ProgramHandlers = {}): Command {
  const program = new Command();
  const initHandler = handlers.init ?? init;
  const doctorHandler = handlers.doctor ?? doctor;

  program
    .name('anvil')
    .description('Scaffold software projects with anti-slop tooling')
    .version(pkg.version, '-V, --version', 'output the anvil version');

  program
    .command('init')
    .description('Scaffold a new project (or re-scaffold an existing one)')
    .addOption(
      new Option('--lang <language>', 'project language')
        .choices(initLangChoices)
        .makeOptionMandatory(true),
    )
    .option('--non-interactive', 'run without interactive prompts (explicit opt-in; D-67)', false)
    .option('--dry-run', 'preview changes without writing to disk', false)
    .action(async (options) => {
      applyInitExitCode(await initHandler(readInitOptions(options as Record<string, unknown>)));
    });

  program
    .command('doctor')
    .description('Verify lint/quality config health and auto-fix non-destructive issues')
    .action(async () => {
      await doctorHandler();
    });

  return program;
}

export const program = createProgram();

if (import.meta.main) {
  await program.parseAsync(process.argv);
}
