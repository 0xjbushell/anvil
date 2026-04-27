#!/usr/bin/env bun
import { program } from '../src/cli.ts';

await program.parseAsync(process.argv);
