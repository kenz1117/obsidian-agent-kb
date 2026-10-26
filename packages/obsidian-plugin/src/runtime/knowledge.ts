import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractScope } from '../domain.js';

export interface RuntimeFolders {
  knowledgeRoot: string;
  autoFolder: string;
  reviewedFolder: string;
  canonicalFolder: string;
  archiveRoot: string;
}

export interface ClientConnection {
  name: string;
  version: string;
  agentId: string;
  connectedAt: string;
}

export class KnowledgeError extends Error {}

const PROTECTED = new Set(['.git', '.obsidian', 'node_modules']);
const CONTEXT_FILES = [
  'AGENTS.md',
  '00-contract/AGENT-CONTRACT.md',
  '00-contract/CONTEXT-PACK.md',
  '00-contract/GLOSSARY.md',
  '00-contract/DECISION-INDEX.md',
  '07-maps/ACTIVE-CONTEXT.md'
];
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
  /\b(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis):\/\/[^\s/:]+:[^\s@]+@/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/
];

function requiredText(args: Record<string, unknown>, key: string, max = 250000): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new KnowledgeError(`${key} is required`);
  if (value.length > max) throw new KnowledgeError(`${key} exceeds ${max} characters`);
  return value.trim();
}

function optionalText(args: Record<string, unknown>, key: string, fallback = '', max = 50000): string {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string') throw new KnowledgeError(`${key} must be a string`);
  if (value.length > max) throw new KnowledgeError(`${key} exceeds ${max} characters`);
  return value.trim();
}

function boundedInt(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new KnowledgeError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeTags(value: unknown, defaults: string[]): string[] {
  if (value === undefined) return defaults;
  if (!Array.isArray(value) || value.length > 20) throw new KnowledgeError('tags must contain at most 20 items');
  const result = value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 64 || /[\x00-\x1f]/.test(item)) {
      throw new KnowledgeError('each tag must contain 1 to 64 printable characters');
    }
    return item.trim();
  });
  return result.length ? result : defaults;
}

export function slugify(value: string): string {
  const slug = value.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/g, '');
  return slug || 'note';
}

export function detectSecret(value: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(value));
}

export function governanceScore(content: string): number {
  const body = content.trim();
  const actionable = /\b(decide|decision|use|prefer|avoid|because|constraint|require|method|steps?|risk|rule)\b/i.test(body);
  const actionability = actionable ? 20 : Math.min(15, Math.floor(body.length / 50));
  const specificity = body.length > 700 ? 10 : body.length > 250 ? 7 : body.length > 70 ? 4 : 0;
  return Math.min(100, 20 + actionability + 15 + 15 + 10 + specificity + 10);
}

function dateParts(): { date: string; compact: string; hhmm: string; year: string; month: string; day: string } {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return { date: `${year}-${month}-${day}`, compact: `${year}${month}${day}`, hhmm, year, month, day };
}

function frontmatter(values: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${JSON.stringify(String(item))}`);
    } else if (typeof value === 'string' && /^[\w./@:+ -]+$/u.test(value)) {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export class KnowledgeRuntime {
  constructor(
    readonly vaultRoot: string,
    private readonly folders: RuntimeFolders,
    private readonly auditDirectory: string,
    readonly agentId = 'obsidian-agent'
  ) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId)) throw new KnowledgeError('invalid agent identity');
    this.vaultRoot = existsSync(vaultRoot) ? realpathSync(vaultRoot) : path.resolve(vaultRoot);
  }

  forAgent(agentId: string): KnowledgeRuntime {
    return new KnowledgeRuntime(this.vaultRoot, this.folders, this.auditDirectory, agentId);
  }

  async ensureAgentProfile(displayName: string): Promise<void> {
    const safeName = displayName.replace(/[\r\n#]/g, '').trim().slice(0, 100) || this.agentId;
    await this.createIfMissing(
      `00-contract/agents/${this.agentId}.md`,
      `# ${safeName}\n\nAgent ID: \`${this.agentId}\`\n\nRead access: vault Markdown.\nWrite access: governed candidates, messages, sessions, and proposals only.\n`
    );
  }

  private assertInside(candidate: string): void {
    const root = path.resolve(this.vaultRoot);
    const resolved = path.resolve(candidate);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new KnowledgeError('path escapes the Obsidian vault');
    }
  }

  private async safePath(raw: unknown, mustExist = false, markdownOnly = true): Promise<{ absolute: string; relative: string }> {
    if (typeof raw !== 'string' || !raw.trim() || raw.includes('\0')) throw new KnowledgeError('path is required');
    const absolute = path.isAbsolute(raw.trim())
      ? path.resolve(raw.trim())
      : path.resolve(this.vaultRoot, raw.trim());
    this.assertInside(absolute);
    const relative = path.relative(this.vaultRoot, absolute).split(path.sep).join('/');
    if (!relative || relative.split('/').some(part => PROTECTED.has(part))) {
      throw new KnowledgeError('this path is protected');
    }
    if (markdownOnly && path.extname(absolute).toLowerCase() !== '.md') {
      throw new KnowledgeError('only Markdown files are supported');
    }
    if (mustExist) {
      let resolved: string;
      try {
        resolved = await realpath(absolute);
      } catch {
        throw new KnowledgeError(`note not found: ${relative}`);
      }
      this.assertInside(resolved);
      if (!(await stat(resolved)).isFile()) throw new KnowledgeError(`note not found: ${relative}`);
      return { absolute: resolved, relative };
    }
    return { absolute, relative };
  }

  private async createIfMissing(relative: string, content: string): Promise<boolean> {
    const target = await this.safePath(relative, false);
    await mkdir(path.dirname(target.absolute), { recursive: true });
    try {
      await writeFile(target.absolute, content, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  async initialize(): Promise<number> {
    const folders = [
      '00-contract/agents',
      '01-inbox',
      '02-sessions',
      `${this.folders.knowledgeRoot}/${this.folders.autoFolder}`,
      `${this.folders.knowledgeRoot}/${this.folders.reviewedFolder}`,
      `${this.folders.knowledgeRoot}/${this.folders.canonicalFolder}`,
      '07-maps',
      this.folders.archiveRoot
    ];
    for (const folder of folders) await mkdir(path.resolve(this.vaultRoot, folder), { recursive: true });
    const documents: Record<string, string> = {
      'AGENTS.md': '# Agent knowledge base\n\nUse the MCP tools to read and search notes. New knowledge must be submitted with `kb_create_inbox_card`; it becomes canonical only after human review in Obsidian.\n',
      '00-contract/AGENT-CONTRACT.md': '# Agent contract\n\n1. Search before creating duplicate knowledge.\n2. Never write secrets or credentials.\n3. Create candidates instead of changing canonical notes directly.\n4. Use `kb_propose_update` for protected changes.\n',
      '00-contract/CONTEXT-PACK.md': '# Context pack\n\nThis vault is the shared long-term knowledge base. Candidate notes live in `03-knowledge/auto`; approved notes live in `03-knowledge/canonical`.\n',
      '00-contract/agents/obsidian-agent.md': '# Obsidian Agent\n\nRead access: vault Markdown.\nWrite access: governed candidates, messages, sessions, and proposals only.\n',
      '07-maps/AGENT-STATUS.md': '# Agent status\n\nThe Obsidian Agent KB background service starts at login and remains available after Obsidian closes.\n',
      '07-maps/ACTIVE-CONTEXT.md': '# Active context\n\nUse `kb_search` to find current canonical knowledge and `kb_read_note` to inspect it.\n'
    };
    let created = 0;
    for (const [relative, content] of Object.entries(documents)) {
      if (await this.createIfMissing(relative, content)) created += 1;
    }
    return created;
  }

  private async audit(tool: string, target: string, result: string): Promise<void> {
    try {
      await mkdir(this.auditDirectory, { recursive: true });
      const record = { timestamp: new Date().toISOString(), agent_id: this.agentId, tool, target, result };
      await appendFile(path.join(this.auditDirectory, 'audit.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // Audit failures must not corrupt a completed vault operation.
    }
  }

  private async writeUnique(tool: string, relative: string, content: string): Promise<Record<string, unknown>> {
    const data = Buffer.from(content, 'utf8');
    if (data.length > 262144) throw new KnowledgeError('content exceeds 262144 bytes');
    if (detectSecret(content)) {
      await this.audit(tool, relative, 'rejected_secret');
      throw new KnowledgeError('write rejected: potential secret detected');
    }
    const parsed = path.posix.parse(relative);
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? '' : `-${index}`;
      const candidateRelative = path.posix.join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);
      const target = await this.safePath(candidateRelative, false);
      await mkdir(path.dirname(target.absolute), { recursive: true });
      const realParent = await realpath(path.dirname(target.absolute));
      this.assertInside(realParent);
      try {
        await writeFile(target.absolute, data, { flag: 'wx' });
        await this.audit(tool, target.relative, 'success');
        return { created: true, path: target.absolute, vault_path: target.relative, bytes: data.length };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new KnowledgeError('unable to allocate a unique note name');
  }

  private async readLimited(relative: string, maxBytes: number): Promise<Record<string, unknown>> {
    const target = await this.safePath(relative, true);
    const info = await stat(target.absolute);
    const length = Math.min(info.size, maxBytes);
    const handle = await open(target.absolute, 'r');
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      return {
        path: target.relative,
        bytes: length,
        total_bytes: info.size,
        truncated: info.size > length,
        content: buffer.toString('utf8')
      };
    } finally {
      await handle.close();
    }
  }

  private async getContext(): Promise<Record<string, unknown>> {
    const files: Record<string, string> = {};
    const truncated: string[] = [];
    for (const relative of [...CONTEXT_FILES, `00-contract/agents/${this.agentId}.md`]) {
      if (!existsSync(path.resolve(this.vaultRoot, relative))) continue;
      const note = await this.readLimited(relative, 65536);
      files[relative] = String(note.content);
      if (note.truncated) truncated.push(relative);
    }
    return { agent_id: this.agentId, read_at: new Date().toISOString(), files, truncated };
  }

  private async walk(directory: string): Promise<string[]> {
    const output: string[] = [];
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return output;
    }
    for (const entry of entries) {
      if (PROTECTED.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) output.push(...await this.walk(absolute));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) output.push(absolute);
    }
    return output;
  }

  private async search(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const query = requiredText(args, 'query', 1000);
    const caseSensitive = args.case_sensitive ?? false;
    if (typeof caseSensitive !== 'boolean') throw new KnowledgeError('case_sensitive must be a boolean');
    const limit = boundedInt(args, 'limit', 20, 1, 50);
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const results: Array<Record<string, unknown>> = [];
    for (const absolute of await this.walk(this.vaultRoot)) {
      if ((await stat(absolute)).size > 1048576) continue;
      const text = await readFile(absolute, 'utf8');
      const matches: Array<Record<string, unknown>> = [];
      text.split(/\r?\n/).forEach((line, index) => {
        if (matches.length >= 5) return;
        const haystack = caseSensitive ? line : line.toLocaleLowerCase();
        if (haystack.includes(needle)) matches.push({ line: index + 1, text: line.trim().slice(0, 300) });
      });
      if (matches.length) {
        results.push({ path: path.relative(this.vaultRoot, absolute).split(path.sep).join('/'), matches });
        if (results.length >= limit) break;
      }
    }
    return { query, count: results.length, results };
  }

  private async createCandidate(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const title = requiredText(args, 'title', 500);
    const content = requiredText(args, 'content');
    const confidence = args.confidence ?? 'medium';
    if (!['low', 'medium', 'high'].includes(String(confidence))) throw new KnowledgeError('invalid confidence');
    const tags = normalizeTags(args.tags, ['inbox', 'agent']);
    const now = dateParts();
    const slug = slugify(optionalText(args, 'slug', title, 128) || title);
    const score = governanceScore(content);
    const relative = `${this.folders.knowledgeRoot}/${this.folders.autoFolder}/${now.date}-${slug}.md`;
    // 适用范围：显式传入优先，否则从正文的"## 适用范围"段落提取。
    const scope = optionalText(args, 'scope', '', 500) || extractScope(content);
    const owner = optionalText(args, 'owner', '', 200) || this.agentId;
    const expiresAt = optionalText(args, 'expires_at', '', 64);
    const version = optionalText(args, 'version', '', 32);
    const text = `${frontmatter({
      id: `kb-${now.compact}-${now.hhmm}-${createHash('sha256').update(`${title}\n${content}`).digest('hex').slice(0, 10)}`,
      type: 'knowledge', title, status: 'auto', confidence, agent: this.agentId,
      origin: 'agent', source: `agent://${this.agentId}`, sensitivity: 'internal',
      created: now.date, updated: now.date, governance_score: score,
      governance_decision: 'review', governance_review_by: 'obsidian-plugin', tags,
      channel: 'knowledge', state: 'active', valid_from: now.date,
      owner, scope, expires_at: expiresAt, version
    })}\n# ${title}\n\n${content}\n`;
    return this.writeUnique('kb_create_inbox_card', relative, text);
  }

  private async createMessage(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const content = requiredText(args, 'content');
    const title = optionalText(args, 'title', 'Agent message', 500) || 'Agent message';
    const now = dateParts();
    const slug = slugify(optionalText(args, 'slug', title, 128) || title);
    const relative = `01-inbox/${this.agentId}/messages/${now.date}-${now.hhmm}-${slug}.md`;
    const text = `${frontmatter({
      id: `message-${now.compact}-${now.hhmm}-${slug}`, type: 'message', title,
      agent: this.agentId, origin: 'agent', source: `agent://${this.agentId}`,
      sensitivity: 'internal', date: now.date, status: 'pending',
      channel: 'memory', state: 'active',
      tags: normalizeTags(args.tags, ['agent-message', this.agentId])
    })}\n# ${title}\n\n${content}\n`;
    return this.writeUnique('kb_create_message', relative, text);
  }

  private async createSession(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const title = requiredText(args, 'title', 500);
    const content = requiredText(args, 'content');
    const result = args.result ?? 'completed';
    if (!['completed', 'partial', 'failed'].includes(String(result))) throw new KnowledgeError('invalid result');
    const now = dateParts();
    const slug = slugify(optionalText(args, 'slug', title, 128) || title);
    const relative = `02-sessions/${now.year}/${now.month}/${now.day}/${now.date}-${now.hhmm}-${this.agentId}-${slug}.md`;
    const text = `${frontmatter({
      id: `session-${now.compact}-${now.hhmm}-${slug}`, type: 'session', title,
      agent: this.agentId, origin: 'agent', source: `agent://${this.agentId}`,
      sensitivity: 'internal', date: now.date, result,
      channel: 'task', state: 'active',
      tags: normalizeTags(args.tags, ['session', 'agent'])
    })}\n# ${title}\n\n${content}\n`;
    return this.writeUnique('kb_create_session_note', relative, text);
  }

  private async proposeUpdate(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const targetRaw = requiredText(args, 'target_path', 4096);
    const reason = requiredText(args, 'reason');
    const proposed = requiredText(args, 'proposed_content');
    const target = await this.safePath(targetRaw, true);
    if (target.relative.startsWith('01-inbox/') || target.relative.startsWith('02-sessions/')) {
      throw new KnowledgeError('proposal target must be outside inbox and sessions');
    }
    const now = dateParts();
    const slug = slugify(optionalText(args, 'slug', path.posix.basename(target.relative, '.md'), 128));
    const relative = `01-inbox/${this.agentId}/proposals/${now.date}-${slug}.proposal.md`;
    const text = `${frontmatter({
      id: `proposal-${now.compact}-${now.hhmm}-${slug}`, type: 'proposal', agent: this.agentId,
      origin: 'agent', source: `agent://${this.agentId}`, sensitivity: 'internal',
      date: now.date, status: 'open', target_path: target.relative
    })}\n# Proposal: ${target.relative}\n\n## Reason\n\n${reason}\n\n## Evidence\n\n${optionalText(args, 'evidence', '待补充') || '待补充'}\n\n## Impact\n\n${optionalText(args, 'impact', '待补充') || '待补充'}\n\n## Proposed Content\n\n\`\`\`markdown\n${proposed}\n\`\`\`\n\n## Rollback\n\n${optionalText(args, 'rollback_note', 'Revert the proposed content after review.')}\n`;
    return this.writeUnique('kb_propose_update', relative, text);
  }

  async recordConnection(name: string, version: string): Promise<void> {
    const connection: ClientConnection = {
      name: name.slice(0, 100) || 'unknown-agent',
      version: version.slice(0, 50),
      agentId: this.agentId,
      connectedAt: new Date().toISOString()
    };
    await mkdir(this.auditDirectory, { recursive: true });
    await appendFile(path.join(this.auditDirectory, 'connections.jsonl'), `${JSON.stringify(connection)}\n`, 'utf8');
  }

  async getRecentConnections(): Promise<ClientConnection[]> {
    try {
      const text = await readFile(path.join(this.auditDirectory, 'connections.jsonl'), 'utf8');
      return text.trim().split(/\r?\n/).slice(-50).reverse().flatMap(line => {
        try {
          const value = JSON.parse(line) as ClientConnection;
          return typeof value.name === 'string' && typeof value.connectedAt === 'string'
            ? [{
              name: value.name,
              version: typeof value.version === 'string' ? value.version : '',
              agentId: typeof value.agentId === 'string' ? value.agentId : 'obsidian-agent',
              connectedAt: value.connectedAt
            }]
            : [];
        } catch {
          return [];
        }
      }).slice(0, 20);
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case 'kb_get_context': return this.getContext();
      case 'kb_search': return this.search(args);
      case 'kb_read_note': return this.readLimited(requiredText(args, 'path', 4096), boundedInt(args, 'max_bytes', 65536, 1, 262144));
      case 'kb_get_status': {
        const profile = await this.readLimited(`00-contract/agents/${this.agentId}.md`, 65536);
        const status = await this.readLimited('07-maps/AGENT-STATUS.md', 65536);
        return { agent_id: this.agentId, registered: true, running: true, profile: profile.content, status: status.content };
      }
      case 'kb_create_inbox_card': return this.createCandidate(args);
      case 'kb_create_message': return this.createMessage(args);
      case 'kb_create_session_note': return this.createSession(args);
      case 'kb_propose_update': return this.proposeUpdate(args);
      default: throw new KnowledgeError(`unknown tool: ${name}`);
    }
  }
}
