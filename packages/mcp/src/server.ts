#!/usr/bin/env node
import { TOOLS } from './tools.ts';

// SDK wiring will be added in the next milestone.
// Keep this executable stable so agent configs can point to it early.
if (process.argv.includes('--list-tools')) {
  console.log(JSON.stringify({ tools: TOOLS }, null, 2));
  process.exit(0);
}

console.error('Obsidian Agent KB MCP server skeleton is not wired to the SDK yet.');
process.exit(2);
