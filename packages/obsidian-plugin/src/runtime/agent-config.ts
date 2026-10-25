import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface AgentConnectionResult {
  connected: string[];
  skipped: string[];
}

export const AGENT_IDS = [
  'workbuddy', 'codex', 'claude-code', 'traecn', 'zcode', 'minimaxcode', 'kimicode',
  'qwen-code', 'claude-desktop', 'cursor', 'windsurf', 'deepseekharness', 'qwen-office', 'doubao-work'
] as const;

export type AgentUrl = string | ((agentId: string) => string);

type ConfigKind = 'url' | 'http' | 'serverUrl' | 'workbuddy' | 'minimax' | 'zcode' | 'qwen' | 'toml';

interface AgentTarget {
  name: string;
  agentId: string;
  file: string | null;
  kind: ConfigKind | null;
  installPaths: string[];
}

function resolveAgentUrl(access: AgentUrl, agentId: string): string {
  return typeof access === 'function' ? access(agentId) : access;
}

export function mergeAgentConfig(existing: unknown, url: string, kind: Exclude<ConfigKind, 'toml'>): Record<string, unknown> {
  const root = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing as Record<string, unknown> }
    : {};
  const entry = kind === 'serverUrl' ? { serverUrl: url }
    : kind === 'http' ? { type: 'http', url }
      : kind === 'workbuddy' ? { type: 'streamableHttp', url, timeout: 30000 }
        : kind === 'minimax' || kind === 'zcode' ? { type: 'streamable-http', url, enabled: true }
          : kind === 'qwen' ? { httpUrl: url } : { url };
  if (kind === 'zcode') {
    const mcp = root.mcp && typeof root.mcp === 'object' && !Array.isArray(root.mcp)
      ? { ...root.mcp as Record<string, unknown> }
      : {};
    const previous = mcp.servers && typeof mcp.servers === 'object' && !Array.isArray(mcp.servers)
      ? mcp.servers as Record<string, unknown>
      : {};
    mcp.servers = { ...previous, 'obsidian-agent-kb': entry };
    root.mcp = mcp;
  } else {
    const previous = root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
      ? root.mcpServers as Record<string, unknown>
      : {};
    root.mcpServers = { ...previous, 'obsidian-agent-kb': entry };
  }
  return root;
}

function codexSection(text: string): { start: number; end: number } | null {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.trim() === '[mcp_servers.obsidian-agent-kb]');
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[.*\]\s*$/.test(lines[end])) end += 1;
  return { start, end };
}

export function mergeCodexConfig(existing: string, url: string): string {
  const section = codexSection(existing);
  const block = `[mcp_servers.obsidian-agent-kb]\nurl = ${JSON.stringify(url)}\nenabled = true`;
  if (!section) return `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`;
  const lines = existing.split('\n');
  lines.splice(section.start, section.end - section.start, ...block.split('\n'));
  return lines.join('\n');
}

function targets(platform: NodeJS.Platform, home: string): AgentTarget[] {
  const appSupport = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support')
    : path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
  const claudeDesktop = platform === 'linux'
    ? path.join(home, '.config', 'Claude', 'claude_desktop_config.json')
    : path.join(appSupport, 'Claude', 'claude_desktop_config.json');
  const macApps = (name: string): string[] => platform === 'darwin'
    ? [path.join('/Applications', `${name}.app`), path.join(home, 'Applications', `${name}.app`)]
    : [];
  const commands = (name: string): string[] => platform === 'win32'
    ? [path.join(home, '.local', 'bin', `${name}.exe`)]
    : [path.join(home, '.local', 'bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`];
  return [
    {
      name: 'WorkBuddy', agentId: 'workbuddy', file: path.join(home, '.workbuddy', 'mcp.json'), kind: 'workbuddy',
      installPaths: [...macApps('WorkBuddy'), ...commands('workbuddy')]
    },
    {
      name: 'Codex', agentId: 'codex', file: path.join(home, '.codex', 'config.toml'), kind: 'toml',
      installPaths: [...macApps('ChatGPT'), ...macApps('Codex'), ...commands('codex')]
    },
    {
      name: 'Claude Code', agentId: 'claude-code', file: path.join(home, '.claude.json'), kind: 'http',
      installPaths: commands('claude')
    },
    {
      name: 'Trae CN', agentId: 'traecn', file: path.join(appSupport, 'Trae CN', 'User', 'mcp.json'), kind: 'http',
      installPaths: macApps('Trae CN')
    },
    {
      name: 'ZCode', agentId: 'zcode', file: path.join(home, '.zcode', 'cli', 'config.json'), kind: 'zcode',
      installPaths: [...macApps('ZCode'), ...commands('zcode')]
    },
    {
      name: 'MiniMax Code', agentId: 'minimaxcode', file: path.join(home, '.minimax', 'mcp.json'), kind: 'minimax',
      installPaths: [...macApps('MiniMax Code'), ...commands('mcode')]
    },
    {
      name: 'Kimi Code', agentId: 'kimicode', file: path.join(home, '.kimi-code', 'mcp.json'), kind: 'url',
      installPaths: [path.join(home, '.kimi-code', 'bin', 'kimi'), ...commands('kimi')]
    },
    {
      name: 'Qwen Code', agentId: 'qwen-code', file: path.join(home, '.qwen', 'settings.json'), kind: 'qwen',
      installPaths: commands('qwen')
    },
    {
      name: 'Claude Desktop', agentId: 'claude-desktop', file: claudeDesktop, kind: 'http',
      installPaths: platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'AnthropicClaude', 'claude.exe')]
        : platform === 'linux' ? ['/usr/bin/claude', '/usr/local/bin/claude'] : macApps('Claude')
    },
    {
      name: 'Cursor', agentId: 'cursor', file: path.join(home, '.cursor', 'mcp.json'), kind: 'url',
      installPaths: platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'cursor', 'Cursor.exe')]
        : [...macApps('Cursor'), ...commands('cursor')]
    },
    {
      name: 'Windsurf', agentId: 'windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), kind: 'serverUrl',
      installPaths: platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Windsurf', 'Windsurf.exe')]
        : [...macApps('Windsurf'), ...commands('windsurf')]
    },
    { name: 'DeepSeek Harness', agentId: 'deepseekharness', file: null, kind: null, installPaths: macApps('DeepSeek Harness') },
    { name: 'Qwen Work', agentId: 'qwen-office', file: null, kind: null, installPaths: macApps('QwenWorkCN') },
    { name: 'Doubao Work', agentId: 'doubao-work', file: null, kind: null, installPaths: [...macApps('Doubao Work'), ...macApps('Doubao')] }
  ];
}

export function detectAgentTargets(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  installationExists: (installPath: string) => boolean = existsSync
): AgentTarget[] {
  return targets(platform, home).filter(target => target.installPaths.some(installationExists));
}

export type AgentConfigurationState = 'configured' | 'needs_update' | 'not_configured' | 'manual' | 'error';

export interface AgentConnectionStatus {
  name: string;
  agentId: string;
  state: AgentConfigurationState;
}

function configuredUrl(config: unknown, kind: ConfigKind): string | null {
  if (kind === 'toml') {
    if (typeof config !== 'string') return null;
    const section = codexSection(config);
    if (!section) return null;
    const body = config.split('\n').slice(section.start + 1, section.end).join('\n');
    const match = body.match(/^\s*url\s*=\s*("(?:\\.|[^"\\])*")\s*$/m);
    if (!match) return null;
    try {
      return JSON.parse(match[1]) as string;
    } catch {
      return null;
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const root = config as Record<string, unknown>;
  const mcp = root.mcp && typeof root.mcp === 'object' && !Array.isArray(root.mcp)
    ? root.mcp as Record<string, unknown>
    : null;
  const servers = kind === 'zcode' ? mcp?.servers : root.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return null;
  const entry = (servers as Record<string, unknown>)['obsidian-agent-kb'];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const value = kind === 'serverUrl' ? record.serverUrl : kind === 'qwen' ? record.httpUrl : record.url;
  return typeof value === 'string' ? value : null;
}

export async function inspectAgentConnections(
  access: AgentUrl,
  platform = process.platform,
  home = homedir(),
  installationExists: (installPath: string) => boolean = existsSync
): Promise<AgentConnectionStatus[]> {
  const statuses: AgentConnectionStatus[] = [];
  for (const target of detectAgentTargets(platform, home, installationExists)) {
    if (!target.file || !target.kind) {
      statuses.push({ name: target.name, agentId: target.agentId, state: 'manual' });
      continue;
    }
    if (!existsSync(target.file)) {
      statuses.push({ name: target.name, agentId: target.agentId, state: 'not_configured' });
      continue;
    }
    try {
      const text = await readFile(target.file, 'utf8');
      const config = target.kind === 'toml' ? text : JSON.parse(text);
      const url = configuredUrl(config, target.kind);
      statuses.push({
        name: target.name,
        agentId: target.agentId,
        state: url === resolveAgentUrl(access, target.agentId) ? 'configured' : url === null ? 'not_configured' : 'needs_update'
      });
    } catch {
      statuses.push({ name: target.name, agentId: target.agentId, state: 'error' });
    }
  }
  return statuses;
}

export async function connectDetectedAgents(
  access: AgentUrl,
  platform = process.platform,
  home = homedir(),
  installationExists: (installPath: string) => boolean = existsSync
): Promise<AgentConnectionResult> {
  const result: AgentConnectionResult = { connected: [], skipped: [] };
  for (const target of detectAgentTargets(platform, home, installationExists)) {
    if (!target.file || !target.kind) {
      result.skipped.push(`${target.name}（请在应用内接入）`);
      continue;
    }
    const file = target.file;
    const kind = target.kind;
    try {
      const url = resolveAgentUrl(access, target.agentId);
      let existing: unknown = kind === 'toml' ? '' : {};
      if (existsSync(file)) {
        const text = await readFile(file, 'utf8');
        existing = kind === 'toml' ? text : JSON.parse(text);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await copyFile(file, `${file}.oakb-backup-${stamp}`);
      }
      const merged = kind === 'toml'
        ? mergeCodexConfig(String(existing), url)
        : `${JSON.stringify(mergeAgentConfig(existing, url, kind), null, 2)}\n`;
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.oakb-tmp-${process.pid}`;
      await writeFile(temporary, merged, 'utf8');
      await rename(temporary, file);
      result.connected.push(target.name);
    } catch {
      result.skipped.push(target.name);
    }
  }
  return result;
}
