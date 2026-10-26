import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageRoot, 'dist/index.js');

async function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 15000);
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'oakb-cli-'));
  const vault = path.join(root, 'vault');
  const runtime = path.join(root, 'runtime');
  const env = {
    KB_VAULT_ROOT: vault,
    KB_RUNTIME_DIR: runtime,
    KB_AGENT_ID: 'test-agent',
    KB_AGENT_IDS: 'test-agent'
  };
  t.after(() => rm(root, { recursive: true, force: true }));
  const initialized = await run(['init', vault], { env });
  assert.equal(initialized.code, 0, initialized.stderr);
  return { root, vault, runtime, env };
}

test('help, version, unknown commands, and argument errors have stable exit codes', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Commands:/);
  assert.equal(help.stderr, '');

  const version = await run(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), '0.2.0');

  const unknown = await run(['not-a-command']);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown command/);

  for (const args of [['promote'], ['archive'], ['review', '--unknown'], ['status', 'extra']]) {
    const result = await run(args);
    assert.equal(result.code, 2, args.join(' '));
    assert.equal(result.stdout, '');
  }
});

test('init creates a governed vault and never overwrites existing files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'oakb-cli-init-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  const startHere = path.join(vault, '07-maps/START-HERE.md');

  const first = await run(['init', vault]);
  assert.equal(first.code, 0, first.stderr);
  const output = JSON.parse(first.stdout);
  assert.equal(output.initialized, true);
  assert.equal(output.vault, vault);
  assert.ok(output.files > 0);
  await access(path.join(vault, '03-knowledge/reviewed'));

  const original = await readFile(startHere, 'utf8');
  await writeFile(startHere, `${original}\nLocal edits.\n`);
  const second = await run(['init', vault]);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /Refusing to overwrite/);
  assert.equal(await readFile(startHere, 'utf8'), `${original}\nLocal edits.\n`);
});

test('doctor returns JSON and maps unhealthy vaults to exit code 1', async t => {
  const { root, env } = await fixture(t);
  const healthy = await run(['doctor'], { env });
  assert.equal(healthy.code, 0, healthy.stderr);
  assert.equal(JSON.parse(healthy.stdout).ok, true);

  const unhealthy = await run(['doctor'], {
    env: { ...env, KB_VAULT_ROOT: path.join(root, 'missing-vault') }
  });
  assert.equal(unhealthy.code, 1, unhealthy.stderr);
  const report = JSON.parse(unhealthy.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.issues.length > 0);
});

test('ingest and distill expose deterministic gateway results', async t => {
  const { vault, env } = await fixture(t);
  await writeFile(path.join(vault, '01-inbox/human/raw.md'), '# Raw input\n\nReview this material.\n');

  const ingested = await run(['ingest'], { env });
  assert.equal(ingested.code, 0, ingested.stderr);
  assert.equal(JSON.parse(ingested.stdout).inbox_cards, 1);
  assert.match(await readFile(path.join(vault, '07-maps/INBOX-REVIEW.md'), 'utf8'), /Raw input/);

  const distilled = await run(['distill'], { env });
  assert.equal(distilled.code, 0, distilled.stderr);
  const result = JSON.parse(distilled.stdout);
  assert.equal(result.scanned, 0);
  assert.equal(result.review_map, '07-maps/GOVERNANCE-REVIEW.md');

  const review = await run(['review'], { env });
  assert.equal(review.code, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).review_map, '07-maps/GOVERNANCE-REVIEW.md');
  const scannedReview = await run(['review', '--scan'], { env });
  assert.equal(scannedReview.code, 0, scannedReview.stderr);
  assert.equal(JSON.parse(scannedReview.stdout).scanned, 0);
});

test('status uses the selected registered agent', async t => {
  const { vault, env } = await fixture(t);
  await mkdir(path.join(vault, '00-contract/agents'), { recursive: true });
  await writeFile(path.join(vault, '07-maps/AGENT-STATUS.md'), '| Test | `test-agent` | confirmed | confirmed | pending |\n');
  await writeFile(path.join(vault, '00-contract/agents/test-agent.md'), '# Test Agent\n');
  await writeFile(path.join(vault, '00-contract/AGENT-REGISTRY.md'), '# Registry\n\n- test-agent\n');

  const result = await run(['--agent', 'test-agent', '--json', 'status'], { env: { ...env, KB_AGENT_ID: '' } });
  assert.equal(result.code, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.agent_id, 'test-agent');
  assert.equal(status.registered, true);
  assert.match(status.profile, /Test Agent/);
});

test('promote and archive enforce arguments and execute governed lifecycle changes', async t => {
  const { vault, env } = await fixture(t);
  const card = path.join(vault, '03-knowledge/reviewed/decision.md');
  await writeFile(card, `---
id: decision
type: knowledge
title: Decision
status: review
source: agent://test-agent
confidence: high
sensitivity: internal
governance_score: 90
owner: Ken
scope: 适用于生命周期变更
created: 2026-10-25
updated: 2026-10-25
tags:
  - test
---

# Decision

Use the governed gateway for lifecycle changes.
`);

  const promoted = await run(['promote', 'decision', '--reviewer', 'Ken'], { env });
  assert.equal(promoted.code, 0, promoted.stderr);
  assert.equal(JSON.parse(promoted.stdout).path, '03-knowledge/canonical/decision.md');
  assert.match(await readFile(path.join(vault, '03-knowledge/canonical/decision.md'), 'utf8'), /review_by: Ken/);

  const archived = await run(['archive', 'decision', '--reason', 'Superseded by a newer decision'], { env });
  assert.equal(archived.code, 0, archived.stderr);
  const archive = JSON.parse(archived.stdout);
  assert.equal(archive.archived, true);
  assert.match(archive.path, /^90-archive\/governance\/manual\/canonical\/decision\.md$/);
  assert.match(await readFile(path.join(vault, archive.path), 'utf8'), /archive_reason: Superseded by a newer decision/);
});
