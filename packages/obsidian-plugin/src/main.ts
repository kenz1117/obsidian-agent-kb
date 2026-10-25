import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, CardSummary, OakbSettings } from './types';
import { OakbReviewView, VIEW_TYPE_OAKB_REVIEW } from './review-view';
import { OakbSettingTab } from './settings-tab';
import { setLocale, t } from './i18n';
import { normalizeFolderPath } from './domain';

export default class ObsidianAgentKbPlugin extends Plugin {
  settings: OakbSettings = DEFAULT_SETTINGS;
  private refreshTimer: number | null = null;

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

    this.addSettingTab(new OakbSettingTab(this.app, this));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
      console.debug('[Obsidian Agent KB] loaded');
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  folderFor(kind: 'auto' | 'reviewed' | 'canonical'): string {
    const s = this.settings;
    if (kind === 'auto') return `${s.knowledgeRoot}/${s.autoFolder}`;
    if (kind === 'reviewed') return `${s.knowledgeRoot}/${s.reviewedFolder}`;
    return `${s.knowledgeRoot}/${s.canonicalFolder}`;
  }

  async collectCards(): Promise<CardSummary[]> {
    const reviewed = this.folderFor('reviewed');
    const auto = this.folderFor('auto');
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${reviewed}/`) || file.path.startsWith(`${auto}/`));
    const cards: CardSummary[] = [];

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm: Record<string, any> = cache?.frontmatter ?? {};
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
        source: String(fm.source ?? ''),
        updated: String(fm.updated ?? ''),
        duplicateOf: typeof fm.duplicate_of === 'string' ? fm.duplicate_of : undefined,
        issues: governanceIssues,
        governanceIssues,
        tags,
        folderKind: file.path.startsWith(`${reviewed}/`) ? 'reviewed' : 'auto'
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
    const destination = `${normalized}/${file.name}`;
    if (destination === normalizeFolderPath(file.path)) return file;
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
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof OakbReviewView) await view.renderQueue();
  }

  async openSource(card: CardSummary): Promise<void> {
    const source = card.source;
    if (!source) {
      new Notice(t('noSource'));
      return;
    }
    const resolved = this.app.metadataCache.getFirstLinkfileDest(source.replace(/^\[\[|\]\]$/g, ''));
    if (resolved instanceof TFile) {
      await this.app.workspace.getLeaf('tab').openFile(resolved);
      return;
    }
    new Notice(`${t('sourceMissing')} ${source}`);
  }

  async markReviewed(file: TFile): Promise<void> {
    await this.updateFrontmatter(file, {
      status: 'review',
      review_by: this.settings.reviewer,
      reviewed_at: new Date().toISOString().slice(0, 10)
    });
    const reviewed = this.folderFor('reviewed');
    if (!file.path.startsWith(`${reviewed}/`)) await this.move(file, reviewed);
  }

  async promoteCard(file: TFile, canonicalFolderOverride?: string): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? {};
    const confidence = String(fm.confidence ?? 'low');
    const score = Number(fm.governance_score ?? 0);
    if (confidence === 'low' || (fm.governance_score !== undefined && score < 80)) {
      new Notice('Cannot promote: governance confidence/score is too low.');
      return;
    }
    await this.updateFrontmatter(file, {
      status: 'canonical',
      review_by: this.settings.reviewer,
      reviewed_at: new Date().toISOString().slice(0, 10),
      governance_decision: 'promoted'
    });
    await this.move(file, canonicalFolderOverride ?? this.folderFor('canonical'));
  }

  async archiveCard(file: TFile, reason = 'manual governance decision'): Promise<void> {
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
