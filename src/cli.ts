import { Command, Option } from 'commander';
import { createRequire } from 'node:module';
import init from './commands/init.ts';
import doctor from './commands/doctor.ts';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name('anvil')
    .description('Scaffold software projects with anti-slop tooling')
    .version(pkg.version, '-V, --version', 'output the anvil version');

  program
    .command('init')
    .description('Scaffold a new project (or re-scaffold an existing one)')
    .addOption(
      new Option('--lang <language>', 'project language')
        .choices(['golang', 'typescript', 'python'])
        .makeOptionMandatory(true),
    )
    .option('--non-interactive', 'run without interactive prompts (explicit opt-in; D-67)', false)
    .option('--dry-run', 'preview changes without writing to disk', false)
    .action(async (options) => {
      await init(options);
    });

  program
    .command('doctor')
    .description('Verify lint/quality config health and auto-fix non-destructive issues')
    .action(async () => {
      await doctor();
    });

  return program;
}

export const program = createProgram();

if (import.meta.main) {
  program.parse(process.argv);
}
