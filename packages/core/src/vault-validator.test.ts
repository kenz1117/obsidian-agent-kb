import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateVault } from './vault-validator.js';

async function createTempVault() {
  const root = await mkdtemp(join(tmpdir(), 'oakb-vault-'));
  for (const dir of [
    '00-contract',
    '01-inbox/human',
    '02-sessions',
    '03-knowledge/auto',
    '03-knowledge/reviewed',
    '03-knowledge/canonical',
    '04-projects',
    '05-decisions',
    '06-sources',
    '07-maps',
    '90-archive'
  ]) {
    await mkdir(join(root, dir), { recursive: true });
  }
  return root;
}

test('reports missing required directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oakb-empty-'));
  const result = await validateVault(root);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'vault/missing-directory'));
  await rm(root, { recursive: true, force: true });
});

test('detects governed files without frontmatter', async () => {
  const root = await createTempVault();
  await writeFile(join(root, '03-knowledge/auto/bad.md'), '# No frontmatter');
  const result = await validateVault(root);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'metadata/no-frontmatter'));
  await rm(root, { recursive: true, force: true });
});

test('accepts valid governed file', async () => {
  const root = await createTempVault();
  await writeFile(
    join(root, '03-knowledge/auto/good.md'),
    `---
id: kb-1
type: knowledge
title: Good
status: auto
source: 06-sources/example.md
origin: agent
confidence: high
sensitivity: internal
created: 2026-01-01
updated: 2026-01-01
tags:
  - test
---

Use SQLite for local metadata.
`
  );
  const result = await validateVault(root);
  assert.deepEqual(
    result.issues.filter((issue) => issue.level === 'error'),
    []
  );
  await rm(root, { recursive: true, force: true });
});
