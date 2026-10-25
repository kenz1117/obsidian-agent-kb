import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from './types.js';
import { KnowledgeRuntime, detectSecret, governanceScore, slugify } from './runtime/knowledge.js';
import { EmbeddedMcpServer } from './runtime/mcp-server.js';
import { connectDetectedAgents, inspectAgentConnections, mergeAgentConfig, mergeCodexConfig } from './runtime/agent-config.js';

async function fixture(t: import('node:test').TestContext): Promise<{ root: string; runtime: KnowledgeRuntime }> {
  const root = await mkdtemp(path.join(tmpdir(), 'oakb-plugin-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const runtime = new KnowledgeRuntime(root, DEFAULT_SETTINGS, path.join(root, 'runtime'));
  await runtime.initialize();
  return { root, runtime };
}

test('initializes a complete vault without overwriting existing notes', async t => {
  const { root, runtime } = await fixture(t);
  assert.equal(await runtime.initialize(), 0);
  const contract = await readFile(path.join(root, '00-contract', 'AGENT-CONTRACT.md'), 'utf8');
  assert.match(contract, /Search before creating/);
  await writeFile(path.join(root, 'AGENTS.md'), 'custom instructions');
  await runtime.initialize();
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'custom instructions');
});

test('creates reviewable candidates and retrieves them through search and read', async t => {
  const { root, runtime } = await fixture(t);
  const created = await runtime.callTool('kb_create_inbox_card', {
    title: '发布规则',
    content: 'Use a single plugin package because customers require one installation step. This decision avoids separate runtime setup.'
  });
  const relative = String(created.vault_path);
  assert.match(relative, /^03-knowledge\/auto\//);
  const source = await readFile(path.join(root, relative), 'utf8');
  assert.match(source, /status: auto/);
  assert.match(source, /governance_score:/);
  const found = await runtime.callTool('kb_search', { query: 'single plugin' });
  assert.equal(found.count, 1);
  const note = await runtime.callTool('kb_read_note', { path: relative });
  assert.match(String(note.content), /发布规则/);
});

test('rejects vault escapes, protected files, secrets, and invalid input', async t => {
  const { runtime } = await fixture(t);
  await assert.rejects(runtime.callTool('kb_read_note', { path: '../outside.md' }), /escapes/);
  await assert.rejects(runtime.callTool('kb_read_note', { path: '.obsidian/workspace.md' }), /protected/);
  await assert.rejects(runtime.callTool('kb_create_inbox_card', {
    title: 'secret', content: 'api_key = "abcdefghijklmnop1234"'
  }), /potential secret/);
  await assert.rejects(runtime.callTool('kb_create_inbox_card', { title: 'missing body' }), /content is required/);
  assert.equal(detectSecret('ordinary knowledge'), false);
  assert.ok(governanceScore('Use this rule because it is required for safe releases.') >= 80);
  assert.equal(slugify('  中文 Title / Test  '), '中文-title-test');
});

test('stores messages, sessions, and update proposals without mutating targets', async t => {
  const { root, runtime } = await fixture(t);
  const target = path.join(root, '00-contract', 'AGENT-CONTRACT.md');
  const before = await readFile(target, 'utf8');
  const proposal = await runtime.callTool('kb_propose_update', {
    target_path: '00-contract/AGENT-CONTRACT.md', reason: 'clarify setup', proposed_content: 'new proposal'
  });
  assert.match(String(proposal.vault_path), /proposals/);
  assert.equal(await readFile(target, 'utf8'), before);
  const message = await runtime.callTool('kb_create_message', { content: 'remember this conversation' });
  const session = await runtime.callTool('kb_create_session_note', { title: 'release', content: 'completed plugin integration' });
  assert.match(String(message.vault_path), /messages/);
  assert.match(String(session.vault_path), /02-sessions/);
});

test('serves MCP over loopback HTTP with tools and governed writes', async t => {
  const { runtime } = await fixture(t);
  const port = 28000 + Math.floor(Math.random() * 1000);
  const token = randomBytes(24).toString('base64url');
  const server = new EmbeddedMcpServer(runtime, port, token);
  await server.start();
  t.after(() => server.stop());

  const initialize = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  });
  assert.equal(initialize.status, 200);
  const initialized = await initialize.json() as any;
  assert.equal(initialized.result.serverInfo.name, 'obsidian-agent-kb');
  const connections = await runtime.getRecentConnections();
  assert.equal(connections[0].name, 'test');
  assert.equal(connections[0].version, '1');

  const list = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  });
  const tools = await list.json() as any;
  assert.equal(tools.result.tools.length, 8);

  const call = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kb_create_inbox_card', arguments: { title: 'HTTP candidate', content: 'Use the embedded MCP server because it removes separate installation.' } } })
  });
  const called = await call.json() as any;
  assert.equal(called.result.isError, false);
  assert.match(called.result.structuredContent.vault_path, /^03-knowledge\/auto\//);

  const wrongPath = await fetch(`http://127.0.0.1:${port}/mcp/wrong`, { method: 'POST' });
  assert.equal(wrongPath.status, 404);
  const foreignOrigin = await fetch(server.url, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(foreignOrigin.status, 403);
});

test('maps per-agent tokens to profiles, governed writes, audit, and connection records', async t => {
  const { root, runtime } = await fixture(t);
  await runtime.forAgent('deepseekharness').ensureAgentProfile('DeepSeek Harness');
  const port = 28000 + Math.floor(Math.random() * 1000);
  const defaultToken = randomBytes(24).toString('base64url');
  const agentToken = randomBytes(24).toString('base64url');
  const server = new EmbeddedMcpServer(runtime, port, {
    [defaultToken]: 'obsidian-agent',
    [agentToken]: 'deepseekharness'
  });
  await server.start();
  t.after(() => server.stop());

  const call = async (url: string, id: number, name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    });
    const body = await response.json() as any;
    assert.equal(body.result.isError, false);
    return body.result.structuredContent;
  };
  const context = await call(server.urlFor('deepseekharness'), 1, 'kb_get_context');
  assert.equal(context.agent_id, 'deepseekharness');
  assert.match(context.files['00-contract/agents/deepseekharness.md'], /DeepSeek Harness/);
  const defaultContext = await call(server.url, 2, 'kb_get_context');
  assert.equal(defaultContext.agent_id, 'obsidian-agent');
  assert.equal(defaultContext.files['00-contract/agents/deepseekharness.md'], undefined);

  const message = await call(server.urlFor('deepseekharness'), 3, 'kb_create_message', {
    title: 'identity check', content: 'This write must belong to DeepSeek Harness.'
  });
  assert.match(String(message.vault_path), /^01-inbox\/deepseekharness\/messages\//);
  const saved = await readFile(path.join(root, String(message.vault_path)), 'utf8');
  assert.match(saved, /agent: deepseekharness/);
  assert.match(saved, /source: agent:\/\/deepseekharness/);
  const audit = await readFile(path.join(root, 'runtime', 'audit.jsonl'), 'utf8');
  assert.match(audit, /"agent_id":"deepseekharness"/);

  const initialize = await fetch(server.urlFor('deepseekharness'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'deepseek-test', version: '1' } } })
  });
  assert.equal(initialize.status, 200);
  const connections = await runtime.getRecentConnections();
  assert.equal(connections[0].agentId, 'deepseekharness');
  await assert.rejects(async () => runtime.forAgent('../outside'), /invalid agent identity/);
});

test('merges agent configuration without removing existing servers', async t => {
  const merged = mergeAgentConfig({ theme: 'dark', mcpServers: { existing: { url: 'http://localhost:1' } } }, 'http://127.0.0.1:2/mcp/token', 'url');
  assert.deepEqual(Object.keys(merged.mcpServers as object), ['existing', 'obsidian-agent-kb']);
  assert.equal(merged.theme, 'dark');

  const home = await mkdtemp(path.join(tmpdir(), 'oakb-agents-'));
  t.after(async () => rm(home, { recursive: true, force: true }));
  const cursor = path.join(home, '.cursor');
  const localInstall = (installPath: string): boolean => installPath.startsWith(home) && existsSync(installPath);
  await mkdir(cursor, { recursive: true });
  await mkdir(path.join(home, 'Applications', 'Cursor.app'), { recursive: true });
  await writeFile(path.join(cursor, 'mcp.json'), JSON.stringify({ mcpServers: { existing: { url: 'old' } } }));
  const access = (agentId: string): string => `http://127.0.0.1:2/mcp/${agentId}-token`;
  const result = await connectDetectedAgents(access, 'darwin', home, localInstall);
  assert.deepEqual(result.connected, ['Cursor']);
  const saved = JSON.parse(await readFile(path.join(cursor, 'mcp.json'), 'utf8'));
  assert.ok(saved.mcpServers.existing);
  assert.equal(saved.mcpServers['obsidian-agent-kb'].url, 'http://127.0.0.1:2/mcp/cursor-token');
  assert.deepEqual(await inspectAgentConnections(access, 'darwin', home, localInstall), [
    { name: 'Cursor', agentId: 'cursor', state: 'configured' }
  ]);
  assert.deepEqual(await inspectAgentConnections('http://127.0.0.1:3/mcp/new-token', 'darwin', home, localInstall), [
    { name: 'Cursor', agentId: 'cursor', state: 'needs_update' }
  ]);
  await rm(path.join(home, 'Applications', 'Cursor.app'), { recursive: true });
  assert.deepEqual(await inspectAgentConnections('http://127.0.0.1:2/mcp/token', 'darwin', home, localInstall), []);
});

test('supports Codex TOML and ZCode nested MCP configuration', () => {
  const original = 'model = "test"\n\n[mcp_servers.obsidian-agent-kb]\nurl = "http://old"\nenabled = false\n\n[mcp_servers.other]\ncommand = "other"\n';
  const updated = mergeCodexConfig(original, 'http://127.0.0.1:27183/mcp/token');
  assert.match(updated, /model = "test"/);
  assert.match(updated, /\[mcp_servers\.obsidian-agent-kb\]\nurl = "http:\/\/127\.0\.0\.1:27183\/mcp\/token"\nenabled = true/);
  assert.match(updated, /\[mcp_servers\.other\]\ncommand = "other"/);
  const zcode = mergeAgentConfig({ mcp: { servers: { other: { command: 'other' } } }, plugins: {} }, 'http://127.0.0.1:27183/mcp/token', 'zcode') as any;
  assert.equal(zcode.mcp.servers.other.command, 'other');
  assert.equal(zcode.mcp.servers['obsidian-agent-kb'].url, 'http://127.0.0.1:27183/mcp/token');
  assert.equal(zcode.mcp.servers['obsidian-agent-kb'].enabled, true);
});
