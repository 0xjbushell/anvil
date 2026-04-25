import chalk from 'chalk';

export interface InitOptions {
  lang: 'typescript' | 'golang' | 'python';
  nonInteractive?: boolean;
  dryRun?: boolean;
}

export default async function init(_options: InitOptions): Promise<void> {
  console.log(chalk.yellow('anvil init: not yet implemented'));
}
