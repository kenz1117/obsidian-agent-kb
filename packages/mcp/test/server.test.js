import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(packageRoot, 'dist/server.js');

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
}

async function startServer(vault, runtime) {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      KB_VAULT_ROOT: vault,
      KB_RUNTIME_DIR: runtime,
      KB_AGENT_ID: 'test-agent',
      KB_AGENT_IDS: 'test-agent'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let stderr = '';
  const messages = [];
  const waiters = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.id === message.id) {
          clearTimeout(waiter.timer);
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });

  return {
    child,
    stderr: () => stderr,
    request(id, method, params) {
      const response = new Promise((resolve, reject) => {
        const existing = messages.find(message => message.id === id);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for response ${id}: ${stderr}`)), 10000);
        waiters.push({ id, resolve, timer });
      });
      child.stdin.write(`${rpc(id, method, params)}\n`);
      return response;
    },
    async close() {
      child.stdin.end();
      if (child.exitCode === null) child.kill('SIGTERM');
    }
  };
}

test('MCP SDK server initializes, lists tools, searches, and writes through governance', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'oakb-mcp-'));
  const vault = path.join(root, 'vault');
  const runtime = path.join(root, 'runtime');
  await mkdir(path.join(vault, '03-knowledge', 'canonical'), { recursive: true });
  await writeFile(path.join(vault, '03-knowledge', 'canonical', 'decision.md'), '# Decision\n\nUse SQLite for local metadata.\n');
  const client = await startServer(vault, runtime);
  t.after(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  const initialized = await client.request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration-test', version: '1.0.0' }
  });
  assert.equal(initialized.result.serverInfo.name, 'obsidian-agent-kb');
  client.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const listed = await client.request(2, 'tools/list');
  assert.equal(listed.result.tools.length, 8);
  assert.ok(listed.result.tools.every(tool => tool.annotations));
  assert.equal(new Set(listed.result.tools.map(tool => tool.name)).size, 8);

  const found = await client.request(3, 'tools/call', {
    name: 'kb_search',
    arguments: { query: 'SQLite', limit: 5 }
  });
  assert.equal(found.result.isError, false);
  assert.equal(found.result.structuredContent.count, 1);

  const created = await client.request(4, 'tools/call', {
    name: 'kb_create_inbox_card',
    arguments: { title: 'MCP integration', content: 'Created through the SDK server.', tags: ['test', 'safe:value'] }
  });
  assert.equal(created.result.isError, false);
  const relative = created.result.structuredContent.vault_path;
  const note = await readFile(path.join(vault, relative), 'utf8');
  assert.match(note, /status: pending/);
  assert.match(note, /source: agent:\/\/test-agent/);
  assert.match(note, /  - "safe:value"/);

  const rejected = await client.request(5, 'tools/call', {
    name: 'kb_read_note',
    arguments: { path: '../outside.md' }
  });
  assert.equal(rejected.result.isError, true);
  assert.match(rejected.result.content[0].text, /escapes vault/);
});

test('--list-tools does not require a configured vault', async () => {
  const result = spawn(process.execPath, [serverPath, '--list-tools'], {
    env: { ...process.env, KB_VAULT_ROOT: '/path/that/does/not/exist' }
  });
  let stdout = '';
  result.stdout.setEncoding('utf8');
  result.stdout.on('data', chunk => { stdout += chunk; });
  await new Promise(resolve => result.once('exit', resolve));
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(stdout).tools.length, 8);
});
