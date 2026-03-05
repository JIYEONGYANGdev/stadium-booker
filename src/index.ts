#!/usr/bin/env node

import { createProgram } from './cli/commands.js';

const program = createProgram();
program.parseAsync(process.argv).catch((error) => {
  console.error('오류:', error instanceof Error ? error.message : error);
  process.exit(1);
});
