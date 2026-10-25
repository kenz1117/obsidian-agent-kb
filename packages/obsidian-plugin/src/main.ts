import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { FileSystemAdapter, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, type CardSummary, type OakbSettings } from './types';
import { OakbReviewView, VIEW_TYPE_OAKB_REVIEW } from './review-view';
import { OakbSettingTab } from './settings-tab';
import { setLocale, t } from './i18n';
import { isWithin, normalizeFolderPath, promotionBlockers, withRoot } from './domain';
import { KnowledgeRuntime, type ClientConnection } from './runtime/knowledge';
import { BackgroundMcpService } from './runtime/background-service';
import { AGENT_IDS, connectDetectedAgents, detectAgentTargets, inspectAgentConnections, type AgentConnectionStatus } from './runtime/agent-config';

export default class ObsidianAgentKbPlugin extends Plugin {
  settings: OakbSettings = { ...DEFAULT_SETTINGS };
  private refreshTimer: number | null = null;
  private runtime: KnowledgeRuntime | null = null;
  private background: BackgroundMcpService | null = null;
  private mcpRunning = false;
  private mcpError = '';

  async onload(): Promise<void> {
    try {
      await this.loadSettings();
      setLocale(this.settings.language);
      this.registerView(VIEW_TYPE_OAKB_REVIEW, (leaf: WorkspaceLeaf) => new OakbReviewView(leaf, this));

      this.addRibbonIcon('database', 'Open Knowledge Review', async () => await this.activateView());
      this.addCommand({ id: 'open-knowledge-review', name: t('commandOpen'), callback: async () => await this.activateView() });
      this.addCommand({ id: 'refresh-knowledge-review', name: t('commandRefresh'), callback: async () => await this.refreshView() });
      this.addCommand({ id: 'review-current-note', name: t('commandReviewNote'), checkCallback: checking => this.currentNoteAction(checking) });
      this.addCommand({ id: 'archive-current-note', name: t('commandArchiveNote'), checkCallback: checking => this.currentNoteAction(checking, 'archive') });
      this.addCommand({ id: 'copy-agent-address', name: t('copyAgentAddress'), callback: async () => await this.copyMcpUrl() });

      this.addSettingTab(new OakbSettingTab(this.app, this));
      this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleRefresh()));
      this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
      this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));

      await this.initializeRuntime();
      if (this.settings.mcpEnabled) await this.startMcp();
      console.debug('[Obsidian Agent KB] loaded with embedded MCP service');
    } catch (error) {
      console.error('[Obsidian Agent KB] load failed', error);
      throw error;
    }
  }

  onunload(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_OAKB_REVIEW);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.knowledgeRoot = normalizeFolderPath(this.settings.knowledgeRoot);
    this.settings.autoFolder = normalizeFolderPath(this.settings.autoFolder);
    this.settings.reviewedFolder = normalizeFolderPath(this.settings.reviewedFolder);
    this.settings.canonicalFolder = normalizeFolderPath(this.settings.canonicalFolder);
    this.settings.archiveRoot = normalizeFolderPath(this.settings.archiveRoot);
    let changed = false;
    if (!Number.isInteger(this.settings.mcpPort) || this.settings.mcpPort < 1024 || this.settings.mcpPort > 65535) {
      this.settings.mcpPort = DEFAULT_SETTINGS.mcpPort;
      changed = true;
    }
    if (!/^[A-Za-z0-9_-]{20,}$/.test(this.settings.mcpToken)) {
      this.settings.mcpToken = randomBytes(24).toString('base64url');
      changed = true;
    }
    const savedTokens = this.settings.agentTokens;
    const validTokens = savedTokens && typeof savedTokens === 'object' && !Array.isArray(savedTokens)
      ? Object.fromEntries(Object.entries(savedTokens).filter(([agentId, token]) =>
        (AGENT_IDS as readonly string[]).includes(agentId) && typeof token === 'string' && /^[A-Za-z0-9_-]{20,}$/.test(token)
      )) as Record<string, string>
      : {};
    if (JSON.stringify(validTokens) !== JSON.stringify(savedTokens || {})) changed = true;
    this.settings.agentTokens = validTokens;
    for (const agentId of AGENT_IDS) {
      if (!this.settings.agentTokens[agentId]) {
        this.settings.agentTokens[agentId] = randomBytes(24).toString('base64url');
        changed = true;
      }
    }
    if (changed) await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.settings.mcpEnabled && this.background) await this.restartMcp();
  }

  private async initializeRuntime(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error('Obsidian Agent KB requires a local desktop vault.');
    const vaultRoot = adapter.getBasePath();
    const pluginDirectory = path.join(vaultRoot, '.obsidian', 'plugins', 'obsidian-agent-kb');
    this.runtime = new KnowledgeRuntime(vaultRoot, this.settings, path.join(pluginDirectory, 'runtime'));
    this.background = new BackgroundMcpService(vaultRoot, pluginDirectory);
    await this.runtime.initialize();
    if (!this.settings.initialized) {
      this.settings.initialized = true;
      await this.saveData(this.settings);
      new Notice(t('initialized'));
    }
  }

  private async startMcp(): Promise<void> {
    if (!this.background) throw new Error('Knowledge runtime is not initialized');
    try {
      await this.background.start(this.settings);
      this.mcpRunning = true;
      this.mcpError = '';
    } catch (error) {
      this.mcpRunning = false;
      this.mcpError = error instanceof Error ? error.message : String(error);
      new Notice(`${t('mcpStartFailed')}${this.mcpError}`, 10000);
    }
  }

  private mcpUrl(agentId = 'obsidian-agent'): string {
    if (this.background) return this.background.url(this.settings, agentId);
    const token = agentId === 'obsidian-agent' ? this.settings.mcpToken : this.settings.agentTokens[agentId];
    if (!token) throw new Error(`No MCP token configured for ${agentId}`);
    return `http://127.0.0.1:${this.settings.mcpPort}/mcp/${token}`;
  }

  getMcpState(): { running: boolean; url: string; error: string } {
    return { running: this.mcpRunning, url: this.mcpUrl(), error: this.mcpError };
  }

  async setMcpEnabled(enabled: boolean): Promise<void> {
    this.settings.mcpEnabled = enabled;
    await this.saveData(this.settings);
    if (enabled) await this.startMcp();
    else {
      await this.background?.stop();
      this.mcpRunning = false;
    }
  }

  async restartMcp(): Promise<void> {
    this.mcpRunning = false;
    this.mcpError = '';
    if (this.settings.mcpEnabled) await this.startMcp();
  }

  async connectAgents(): Promise<string> {
    if (!this.mcpRunning) throw new Error(t('mcpNotRunning'));
    for (const target of detectAgentTargets()) {
      await this.runtime?.forAgent(target.agentId).ensureAgentProfile(target.name);
    }
    const result = await connectDetectedAgents(agentId => this.mcpUrl(agentId));
    if (result.connected.length) return `${t('connectedAgents')}${result.connected.join('、')}${result.skipped.length ? `；${t('skippedAgents')}${result.skipped.join('、')}` : ''}`;
    if (result.skipped.length) return `${t('skippedAgents')}${result.skipped.join('、')}`;
    return t('noAgentsDetected');
  }

  async copyMcpUrl(): Promise<void> {
    if (!this.mcpRunning) throw new Error(t('mcpNotRunning'));
    await navigator.clipboard.writeText(this.mcpUrl());
    new Notice(t('addressCopied'));
  }

  async copyAgentUrl(agentId: string): Promise<void> {
    if (!this.mcpRunning) throw new Error(t('mcpNotRunning'));
    const target = detectAgentTargets().find(agent => agent.agentId === agentId);
    if (!target) throw new Error(t('noAgentsDetected'));
    await this.runtime?.forAgent(agentId).ensureAgentProfile(target.name);
    await navigator.clipboard.writeText(this.mcpUrl(agentId));
    new Notice(`${target.name}: ${t('addressCopied')}`);
  }

  async getAgentStatuses(): Promise<AgentConnectionStatus[]> {
    return inspectAgentConnections(agentId => this.mcpUrl(agentId));
  }

  async getRecentConnections(): Promise<ClientConnection[]> {
    const connections = await this.runtime?.getRecentConnections() ?? [];
    return connections.filter(connection => connection.name !== 'obsidian-agent-kb-self-test');
  }

  async testMcpConnection(): Promise<string> {
    if (!this.mcpRunning) throw new Error(t('mcpNotRunning'));
    const mcpUrl = this.getMcpState().url;
    const request = async (id: number, method: string, params: Record<string, unknown>): Promise<any> => {
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      return new Promise<any>((resolve, reject) => {
        const req = httpRequest(mcpUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'content-length': Buffer.byteLength(body)
          },
          timeout: 5000
        }, response => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              req.destroy(new Error('MCP response exceeds 2 MiB'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            try {
              if (response.statusCode !== 200) throw new Error(`MCP HTTP ${response.statusCode ?? 'unknown'}`);
              const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (result.error) throw new Error(result.error.message || 'MCP request failed');
              resolve(result.result);
            } catch (error) {
              reject(error);
            }
          });
          response.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('MCP connection test timed out')));
        req.on('error', reject);
        req.end(body);
      });
    };
    await request(1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'obsidian-agent-kb-self-test', version: this.manifest.version }
    });
    const tools = await request(2, 'tools/list', {});
    const count = Array.isArray(tools.tools) ? tools.tools.length : 0;
    if (count !== 8) throw new Error(`Expected 8 MCP tools, received ${count}`);
    return t('connectionTestPassed', count);
  }

  openSettings(): void {
    const setting = (this.app as unknown as {
      setting: { open(): void; openTabById(id: string): void };
    }).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  folderFor(kind: 'auto' | 'reviewed' | 'canonical'): string {
    const s = this.settings;
    if (kind === 'auto') return withRoot(s.knowledgeRoot, s.autoFolder);
    if (kind === 'reviewed') return withRoot(s.knowledgeRoot, s.reviewedFolder);
    return withRoot(s.knowledgeRoot, s.canonicalFolder);
  }

  async collectCards(): Promise<CardSummary[]> {
    const knowledgeRoot = normalizeFolderPath(this.settings.knowledgeRoot);
    const archiveRoot = normalizeFolderPath(this.settings.archiveRoot);
    const files = this.app.vault.getMarkdownFiles().filter(file =>
      isWithin(file.path, knowledgeRoot) || isWithin(file.path, archiveRoot)
    );
    const cards: CardSummary[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm: Record<string, unknown> = cache?.frontmatter ?? {};
      const governanceIssues = Array.isArray(fm.governance_issues) ? fm.governance_issues.map(String) : [];
      const tags = Array.isArray(fm.tags) ? fm.tags.map(tag => String(tag)) : [];
      cards.push({
        file,
        path: file.path,
        basename: file.basename,
        title: String(fm.title ?? file.basename),
        status: String(fm.status ?? 'unknown'),
        score: typeof fm.governance_score === 'number' ? fm.governance_score : null,
        confidence: String(fm.confidence ?? 'unknown'),
        sensitivity: String(fm.sensitivity ?? 'internal'),
        source: String(fm.source ?? ''),
        updated: String(fm.updated ?? ''),
        duplicateOf: typeof fm.duplicate_of === 'string' ? fm.duplicate_of : undefined,
        issues: governanceIssues,
        governanceIssues,
        tags
      });
    }

    return cards.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title));
  }

  async refreshView(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_OAKB_REVIEW)[0];
    const view = leaf?.view;
    if (view instanceof OakbReviewView) await view.renderQueue();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshView();
    }, 500);
  }

  private currentNoteAction(checking: boolean, action: 'review' | 'archive' = 'review'): boolean | void {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || !file.path.startsWith(`${this.settings.knowledgeRoot}/`)) return false;
    if (checking) return true;
    if (action === 'archive') void this.archiveCard(file, t('archivedFromNote'));
    else void this.markReviewed(file);
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizeFolderPath(path);
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    const parts = normalized.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private async updateFrontmatter(file: TFile, changes: Record<string, any>): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, fm => {
      fm.updated = new Date().toISOString().slice(0, 10);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined) delete fm[key];
        else fm[key] = value;
      }
    });
  }

  private async move(file: TFile, folder: string): Promise<TFile> {
    await this.ensureFolder(folder);
    const normalized = normalizeFolderPath(folder);
    let destination = `${normalized}/${file.name}`;
    if (destination === normalizeFolderPath(file.path)) return file;
    const extension = file.extension ? `.${file.extension}` : '';
    const basename = file.name.slice(0, file.name.length - extension.length);
    for (let index = 1; this.app.vault.getAbstractFileByPath(destination); index += 1) {
      destination = `${normalized}/${basename}-${index}${extension}`;
    }
    await this.app.fileManager.renameFile(file, destination);
    const moved = this.app.vault.getAbstractFileByPath(destination);
    if (!(moved instanceof TFile)) throw new Error(`Moved note not found: ${destination}`);
    return moved;
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_OAKB_REVIEW)[0] ?? null;
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) {
        new Notice(t('unablePane'));
        return;
      }
      await rightLeaf.setViewState({ type: VIEW_TYPE_OAKB_REVIEW, active: true });
      leaf = rightLeaf;
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof OakbReviewView) await view.renderQueue();
  }

  async openSource(card: CardSummary): Promise<void> {
    const source = card.source;
    if (!source) {
      new Notice(t('noSource'));
      return;
    }
    const linkpath = source.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0];
    const resolved = this.app.metadataCache.getFirstLinkpathDest(linkpath, card.path);
    if (resolved instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(resolved);
      return;
    }
    new Notice(`${t('sourceMissing')} ${source}`);
  }

  async markReviewed(file: TFile): Promise<void> {
    if (!isWithin(file.path, this.settings.knowledgeRoot)) throw new Error('Only governed knowledge files can be reviewed');
    await this.updateFrontmatter(file, {
      status: 'review',
      review_by: this.settings.reviewer,
      reviewed_at: new Date().toISOString().slice(0, 10)
    });
    const reviewed = this.folderFor('reviewed');
    if (!isWithin(file.path, reviewed)) await this.move(file, reviewed);
  }

  async promoteCard(file: TFile, canonicalFolderOverride?: string): Promise<boolean> {
    if (!isWithin(file.path, this.settings.knowledgeRoot)) throw new Error('Only governed knowledge files can be promoted');
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const blockers = promotionBlockers({
      status: String(fm.status ?? 'unknown'),
      score: typeof fm.governance_score === 'number' ? fm.governance_score : null,
      confidence: String(fm.confidence ?? 'unknown'),
      sensitivity: fm.sensitivity
    });
    if (blockers.length) {
      new Notice(`${t('cannotPromote')} ${blockers.join('; ')}`);
      return false;
    }
    await this.updateFrontmatter(file, {
      status: 'canonical',
      review_by: this.settings.reviewer,
      reviewed_at: new Date().toISOString().slice(0, 10),
      governance_decision: 'promoted'
    });
    await this.move(file, canonicalFolderOverride ?? this.folderFor('canonical'));
    return true;
  }

  async archiveCard(file: TFile, reason = 'manual governance decision'): Promise<void> {
    if (!isWithin(file.path, this.settings.knowledgeRoot) && !isWithin(file.path, this.settings.archiveRoot)) {
      throw new Error('Only governed knowledge files can be archived');
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    await this.updateFrontmatter(file, {
      status: 'archive',
      archived_at: new Date().toISOString().slice(0, 10),
      archive_reason: reason,
      governance_decision: 'archived'
    });
    await this.move(file, `${this.settings.archiveRoot}/${stamp}`);
  }

  async resolveConflict(card: CardSummary): Promise<void> {
    const duplicatePath = card.duplicateOf;
    if (duplicatePath) new Notice(`Keeping this card requires reviewing duplicate: ${duplicatePath}`);
    await this.markReviewed(card.file);
  }
}
