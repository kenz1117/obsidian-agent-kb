import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { FileSystemAdapter, Notice, Plugin, TFile, WorkspaceLeaf, requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS, type CardSummary, type OakbServiceState, type OakbSettings } from './types';
import { OakbReviewView, VIEW_TYPE_OAKB_REVIEW } from './review-view';
import { OakbSettingTab } from './settings-tab';
import { setLocale, t } from './i18n';
import { extractScope, hasJudgment, isWithin, normalizeFolderPath, promotionBlockers, withRoot } from './domain';
import { KnowledgeRuntime, type ClientConnection } from './runtime/knowledge';
import { BackgroundMcpService } from './runtime/background-service';
import { AGENT_IDS, connectDetectedAgents, detectAgentTargets, inspectAgentConnections, type AgentConnectionStatus } from './runtime/agent-config';
import {
  DecisionEngine,
  planAutoAction,
  resolveApiKey,
  type AutoDecisionPlan,
  type DecisionContext,
  type DecisionOutcome,
  type DecisionRequest,
  type DecisionSettings
} from './runtime/decision';

export default class ObsidianAgentKbPlugin extends Plugin {
  settings: OakbSettings = { ...DEFAULT_SETTINGS };
  private refreshTimer: number | null = null;
  private runtime: KnowledgeRuntime | null = null;
  private background: BackgroundMcpService | null = null;
  private mcpState: OakbServiceState = 'stopped';
  private mcpError = '';
  private serviceStateListeners: Array<(state: OakbServiceState) => void> = [];
  private decidedPaths = new Set<string>();
  private autoDeciding = false;

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
      // The background service must never block Obsidian's plugin load: the
      // launch agent may need seconds to come up, and it is designed to keep
      // running independently of Obsidian.
      if (this.settings.mcpEnabled) void this.startMcp();
      console.log('[Obsidian Agent KB] loaded with embedded MCP service');
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
    // `manifest.dir` is the vault-relative plugin folder, so the plugin works
    // even when the folder is renamed. Fall back to the conventional path.
    const pluginDirectory = this.manifest.dir
      ? path.join(vaultRoot, this.manifest.dir)
      : path.join(vaultRoot, '.obsidian', 'plugins', this.manifest.id);
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
    this.setServiceState('starting');
    try {
      await this.background.start(this.settings);
      this.mcpError = '';
      this.setServiceState('running');
    } catch (error) {
      this.mcpError = error instanceof Error ? error.message : String(error);
      this.setServiceState('error');
      new Notice(`${t('mcpStartFailed')}${this.mcpError}`, 10000);
    }
  }

  private setServiceState(state: OakbServiceState): void {
    if (this.mcpState === state) return;
    this.mcpState = state;
    for (const listener of [...this.serviceStateListeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error('[Obsidian Agent KB] service state listener failed', error);
      }
    }
  }

  onServiceStateChange(listener: (state: OakbServiceState) => void): () => void {
    this.serviceStateListeners.push(listener);
    return () => {
      this.serviceStateListeners = this.serviceStateListeners.filter(item => item !== listener);
    };
  }

  private mcpUrl(agentId = 'obsidian-agent'): string {
    if (this.background) return this.background.url(this.settings, agentId);
    const token = agentId === 'obsidian-agent' ? this.settings.mcpToken : this.settings.agentTokens[agentId];
    if (!token) throw new Error(`No MCP token configured for ${agentId}`);
    return `http://127.0.0.1:${this.settings.mcpPort}/mcp/${token}`;
  }

  getMcpState(): { state: OakbServiceState; running: boolean; url: string; error: string } {
    return { state: this.mcpState, running: this.mcpState === 'running', url: this.mcpUrl(), error: this.mcpError };
  }

  async setMcpEnabled(enabled: boolean): Promise<void> {
    this.settings.mcpEnabled = enabled;
    await this.saveData(this.settings);
    if (enabled) await this.startMcp();
    else {
      await this.background?.stop();
      this.mcpError = '';
      this.setServiceState('stopped');
    }
  }

  async restartMcp(): Promise<void> {
    this.mcpError = '';
    if (this.settings.mcpEnabled) await this.startMcp();
    else this.setServiceState('stopped');
  }

  async connectAgents(): Promise<string> {
    if (this.mcpState !== 'running') throw new Error(t('mcpNotRunning'));
    for (const target of detectAgentTargets()) {
      await this.runtime?.forAgent(target.agentId).ensureAgentProfile(target.name);
    }
    const result = await connectDetectedAgents(agentId => this.mcpUrl(agentId));
    if (result.connected.length) return `${t('connectedAgents')}${result.connected.join('、')}${result.skipped.length ? `；${t('skippedAgents')}${result.skipped.join('、')}` : ''}`;
    if (result.skipped.length) return `${t('skippedAgents')}${result.skipped.join('、')}`;
    return t('noAgentsDetected');
  }

  async copyMcpUrl(): Promise<void> {
    if (this.mcpState !== 'running') throw new Error(t('mcpNotRunning'));
    await navigator.clipboard.writeText(this.mcpUrl());
    new Notice(t('addressCopied'));
  }

  async copyAgentUrl(agentId: string): Promise<void> {
    if (this.mcpState !== 'running') throw new Error(t('mcpNotRunning'));
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
    if (this.mcpState !== 'running') throw new Error(t('mcpNotRunning'));
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
        tags,
        owner: String(fm.owner ?? ''),
        scope: String(fm.scope ?? ''),
        state: String(fm.state ?? 'active'),
        expiresAt: String(fm.expires_at ?? ''),
        channel: String(fm.channel ?? '')
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
    // Use the workspace's own window so the timer keeps working when Obsidian
    // opens settings or a note in a popout window.
    const view = this.app.workspace.containerEl.ownerDocument.defaultView;
    if (!view) return;
    if (this.refreshTimer) view.clearTimeout(this.refreshTimer);
    this.refreshTimer = view.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshView();
      void this.processNewCandidates();
    }, 500);
  }

  /**
   * Optionally run the decision model on freshly submitted candidate cards.
   * Each card is judged at most once, and the model never overrides the hard
   * governance rules.
   */
  private async processNewCandidates(): Promise<void> {
    const settings = this.settings;
    if (!settings.autoDecisionEnabled || !settings.autoDecisionOnNewCard) return;
    if (this.autoDeciding) return;
    this.autoDeciding = true;
    try {
      const autoFolder = this.folderFor('auto');
      const cards = (await this.collectCards())
        .filter(card => isWithin(card.path, autoFolder))
        .filter(card => card.status === 'auto' || card.status === 'pending')
        .filter(card => !this.decidedPaths.has(card.path))
        .slice(0, Math.max(1, settings.autoDecisionMaxItems));
      for (const card of cards) {
        if (this.decidedPaths.has(card.path)) continue;
        this.decidedPaths.add(card.path);
        const plan = await this.decideCard(card);
        if (plan.action === 'promote' && settings.autoDecisionAutoPromote) {
          await this.applyDecision(card, plan);
        }
      }
    } catch (error) {
      console.error('[Obsidian Agent KB] auto decision failed', error);
    } finally {
      this.autoDeciding = false;
    }
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
    const body = await this.readCardBody(file);
    const scope = String(fm.scope ?? '').trim() || extractScope(body);
    const blockers = promotionBlockers({
      status: String(fm.status ?? 'unknown'),
      score: typeof fm.governance_score === 'number' ? fm.governance_score : null,
      confidence: String(fm.confidence ?? 'unknown'),
      sensitivity: fm.sensitivity,
      owner: String(fm.owner ?? '').trim(),
      scope,
      expires_at: fm.expires_at ? String(fm.expires_at) : undefined,
      state: fm.state ? String(fm.state) : undefined,
      duplicateOf: fm.duplicate_of ? String(fm.duplicate_of) : undefined
    });
    // 第三道门：正确性与结构化——内容必须包含可复用的判断，而不只是资料。
    if (!hasJudgment(body)) blockers.push('content contains no reusable judgment');
    if (blockers.length) {
      new Notice(`${t('cannotPromote')} ${blockers.join('; ')}`);
      return false;
    }
    const today = new Date().toISOString().slice(0, 10);
    await this.updateFrontmatter(file, {
      status: 'canonical',
      review_by: this.settings.reviewer,
      reviewed_at: today,
      governance_decision: 'promoted',
      // Owner 与适用范围在晋升时落定：Owner 是"对正确性负责的人"，
      // 不是"提交这张卡的人"——后者记在 origin / agent 字段。
      owner: String(fm.owner ?? '').trim() || this.settings.reviewer,
      scope,
      valid_from: String(fm.valid_from ?? '').trim() || today,
      state: 'active',
      channel: 'knowledge'
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

  // ------------------------------------------------------ auto decision --

  private decisionSettings(): DecisionSettings {
    const s = this.settings;
    return {
      provider: s.autoDecisionProvider,
      endpoint: s.autoDecisionEndpoint,
      model: s.autoDecisionModel,
      apiKeyEnv: s.autoDecisionApiKeyEnv,
      threshold: s.autoDecisionThreshold,
      autoPromote: s.autoDecisionAutoPromote,
      autoArchive: s.autoDecisionAutoArchive,
      dryRun: s.autoDecisionDryRun,
      maxItems: s.autoDecisionMaxItems
    };
  }

  async hasDecisionApiKey(): Promise<boolean> {
    return (await resolveApiKey(this.settings.autoDecisionApiKeyEnv)).length > 0;
  }

  private async decisionTransport(request: DecisionRequest): Promise<{ status: number; body: string }> {
    const view = this.app.workspace.containerEl.ownerDocument.defaultView;
    const timeout = new Promise<never>((_, reject) => {
      const timer = view?.setTimeout(() => reject(new Error('decision request timed out after 60s')), 60000);
      if (timer === undefined) reject(new Error('decision request could not be scheduled'));
    });
    const response = await Promise.race([
      requestUrl({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        contentType: 'application/json',
        throw: false
      }),
      timeout
    ]);
    return { status: response.status, body: response.text };
  }

  /** Read a card body without its frontmatter, for the decision model. */
  async readCardBody(file: TFile): Promise<string> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      return (match ? raw.slice(match[0].length) : raw).trim();
    } catch {
      return '';
    }
  }

  async decideCard(card: CardSummary): Promise<AutoDecisionPlan> {
    const settings = this.decisionSettings();
    const apiKey = await resolveApiKey(settings.apiKeyEnv);
    if (!apiKey) {
      return planAutoAction(
        { promotable: false, confidence: 0, qualityScore: 0, needsHumanReview: true, category: 'unknown', reason: '', provider: settings.provider, model: settings.model, raw: null, error: t('decisionNoApiKey') },
        card,
        settings,
        promotionBlockers({ status: card.status, score: card.score, confidence: card.confidence, sensitivity: card.sensitivity })
      );
    }
    const engine = new DecisionEngine(settings, request => this.decisionTransport(request), apiKey);
    const context: DecisionContext = {
      title: card.title,
      content: await this.readCardBody(card.file),
      tags: card.tags,
      source: card.source,
      score: card.score,
      confidence: card.confidence,
      sensitivity: card.sensitivity,
      status: card.status
    };
    const outcome: DecisionOutcome = await engine.decide(context);
    const plan = planAutoAction(
      outcome,
      card,
      settings,
      promotionBlockers({ status: card.status, score: card.score, confidence: card.confidence, sensitivity: card.sensitivity })
    );
    await this.recordDecision(card, plan);
    return plan;
  }

  /**
   * Apply a decision plan. Dry-run mode never mutates the vault unless the
   * human explicitly confirms the action in the decision modal.
   */
  async applyDecision(card: CardSummary, plan: AutoDecisionPlan, force = false): Promise<boolean> {
    const settings = this.decisionSettings();
    if (settings.dryRun && !force) return false;
    if (plan.action === 'promote') {
      const promoted = await this.promoteCard(card.file);
      if (promoted) {
        await this.updateFrontmatter(card.file, {
          governance_decision: 'auto-promoted',
          auto_decision_confidence: plan.outcome.confidence,
          auto_decision_model: plan.outcome.model,
          auto_decision_reason: plan.reason.slice(0, 500)
        });
      }
      return promoted;
    }
    if (plan.action === 'archive') {
      await this.archiveCard(card.file, `auto: ${plan.reason.slice(0, 300)}`);
      return true;
    }
    return false;
  }

  private async recordDecision(card: CardSummary, plan: AutoDecisionPlan): Promise<void> {
    try {
      const directory = path.join(this.app.vault.adapter instanceof FileSystemAdapter
        ? this.app.vault.adapter.getBasePath()
        : '', '.obsidian', 'plugins', 'obsidian-agent-kb', 'runtime');
      await mkdir(directory, { recursive: true });
      const record = {
        timestamp: new Date().toISOString(),
        path: card.path,
        title: card.title,
        action: plan.action,
        reason: plan.reason,
        blockers: plan.blockers,
        provider: plan.outcome.provider,
        model: plan.outcome.model,
        confidence: plan.outcome.confidence,
        quality_score: plan.outcome.qualityScore,
        category: plan.outcome.category,
        needs_human_review: plan.outcome.needsHumanReview,
        error: plan.outcome.error ?? null
      };
      await appendFile(path.join(directory, 'decisions.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      console.error('[Obsidian Agent KB] failed to record decision', error);
    }
  }
}
