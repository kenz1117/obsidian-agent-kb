#!/usr/bin/env node
const commands = {
  init: 'Initialize a governed vault',
  doctor: 'Validate vault structure and governance policy',
  ingest: 'Process raw inbox material',
  distill: 'Generate candidate knowledge cards',
  review: 'List cards requiring review',
  promote: 'Promote reviewed cards to canonical',
  archive: 'Archive stale or low-value objects',
  status: 'Show vault and agent status'
} as const;

const arg = process.argv[2];

if (!arg || !(arg in commands)) {
  console.error('Obsidian Agent KB CLI');
  console.error('');
  console.error('Usage: oakb <command>');
  console.error('');
  for (const [name, description] of Object.entries(commands)) {
    console.error(`  ${name.padEnd(10)} ${description}`);
  }
  process.exit(arg ? 2 : 0);
}

console.error(`"${arg}" is not implemented yet.`);
process.exit(2);
