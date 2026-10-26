import { execFile } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { OakbSettings } from '../types';

const execute = promisify(execFile);
const SERVICE_LABEL = 'md.obsidian.agent-kb';
const LAUNCHCTL_TIMEOUT_MS = 15000;
const HEALTH_TIMEOUT_MS = 15000;

export interface ServiceConfig {
  vaultRoot: string;
  auditDirectory: string;
  folders: {
    knowledgeRoot: string;
    autoFolder: string;
    reviewedFolder: string;
    canonicalFolder: string;
    archiveRoot: string;
  };
  port: number;
  tokens: Record<string, string>;
}

function servicePlist(executable: string, script: string, config: string, log: string, errorLog: string): string {
  const xml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(executable)}</string><string>${xml(script)}</string><string>${xml(config)}</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(errorLog)}</string>
</dict></plist>\n`;
}

export class BackgroundMcpService {
  private readonly runtimeDirectory: string;
  private readonly executable: string;
  private readonly script: string;
  private readonly config: string;
  private readonly plist: string;

  constructor(private readonly vaultRoot: string, pluginDirectory: string, home = homedir()) {
    this.runtimeDirectory = path.join(vaultRoot, '.obsidian', 'plugins', 'obsidian-agent-kb', 'runtime');
    this.executable = path.join(pluginDirectory, 'service-node');
    this.script = path.join(pluginDirectory, 'service.js');
    this.config = path.join(this.runtimeDirectory, 'service.json');
    this.plist = path.join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  }

  url(settings: OakbSettings, agentId = 'obsidian-agent'): string {
    const token = agentId === 'obsidian-agent' ? settings.mcpToken : settings.agentTokens[agentId];
    if (!token) throw new Error(`No MCP token configured for ${agentId}`);
    return `http://127.0.0.1:${settings.mcpPort}/mcp/${token}`;
  }

  private buildConfig(settings: OakbSettings): ServiceConfig {
    return {
      vaultRoot: this.vaultRoot,
      auditDirectory: this.runtimeDirectory,
      folders: {
        knowledgeRoot: settings.knowledgeRoot,
        autoFolder: settings.autoFolder,
        reviewedFolder: settings.reviewedFolder,
        canonicalFolder: settings.canonicalFolder,
        archiveRoot: settings.archiveRoot
      },
      port: settings.mcpPort,
      tokens: {
        [settings.mcpToken]: 'obsidian-agent',
        ...Object.fromEntries(Object.entries(settings.agentTokens).map(([agentId, token]) => [token, agentId]))
      }
    };
  }

  /**
   * True when a service is already listening with exactly the configuration we
   * want. Only then may the plugin adopt it instead of restarting it.
   */
  async isCurrentAndHealthy(settings: OakbSettings): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    let existing: string;
    try {
      existing = await readFile(this.config, 'utf8');
    } catch {
      return false;
    }
    let matches = false;
    try {
      const parsed = JSON.parse(existing) as ServiceConfig;
      const desired = this.buildConfig(settings);
      matches = JSON.stringify(parsed) === JSON.stringify(desired);
    } catch {
      matches = false;
    }
    if (!matches) return false;
    return this.checkHealth(settings.mcpPort);
  }

  async start(settings: OakbSettings): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('The embedded background service currently requires macOS');
    if (typeof process.getuid !== 'function') throw new Error('Cannot determine the current user');

    // Fast path: the launch agent is already running this exact configuration.
    // Restarting it would needlessly drop every live agent connection and cost
    // seconds of plugin load time.
    if (await this.isCurrentAndHealthy(settings)) return;

    await mkdir(this.runtimeDirectory, { recursive: true });
    await mkdir(path.dirname(this.plist), { recursive: true });
    await writeFile(this.config, `${JSON.stringify(this.buildConfig(settings), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await writeFile(this.plist, servicePlist(
      this.executable,
      this.script,
      this.config,
      path.join(this.runtimeDirectory, 'service.log'),
      path.join(this.runtimeDirectory, 'service-error.log')
    ), 'utf8');

    const domain = `gui/${process.getuid()}`;
    await execute('launchctl', ['bootout', domain, this.plist], { timeout: LAUNCHCTL_TIMEOUT_MS }).catch(() => undefined);
    await execute('launchctl', ['bootstrap', domain, this.plist], { timeout: LAUNCHCTL_TIMEOUT_MS });
    await this.waitForHealth(settings.mcpPort);
  }

  async stop(): Promise<void> {
    if (process.platform !== 'darwin' || typeof process.getuid !== 'function') return;
    await execute('launchctl', ['bootout', `gui/${process.getuid()}`, this.plist], { timeout: LAUNCHCTL_TIMEOUT_MS })
      .catch(() => undefined);
  }

  private async waitForHealth(port: number): Promise<void> {
    let lastError: unknown;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let delay = 25;
    while (Date.now() < deadline) {
      try {
        await this.checkHealth(port);
        return;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 250);
      }
    }
    throw new Error(`Background MCP service did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async checkHealth(port: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const request = httpGet({ hostname: '127.0.0.1', port, path: '/health', timeout: 1000 }, response => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('timeout', () => request.destroy(new Error('Health check timed out')));
      request.on('error', () => resolve(false));
    });
  }
}
