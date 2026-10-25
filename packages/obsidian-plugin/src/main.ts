import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, OakbSettings } from './types';
import { OakbReviewView, VIEW_TYPE_OAKB_REVIEW } from './review-view';
import { OakbSettingTab } from './settings-tab';

export default class ObsidianAgentKbPlugin extends Plugin {
  settings: OakbSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_OAKB_REVIEW, (leaf: WorkspaceLeaf) => new OakbReviewView(leaf, this));

    this.addRibbonIcon('database', 'Open Knowledge Review', async () => {
      await this.activateView();
    });

    this.addCommand({
      id: 'open-knowledge-review',
      name: 'Open knowledge review',
      callback: async () => await this.activateView()
    });

    this.addSettingTab(new OakbSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_OAKB_REVIEW);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_OAKB_REVIEW)[0] ?? null;
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) {
        new Notice('Unable to create Knowledge Review pane.');
        return;
      }
      await rightLeaf.setViewState({ type: VIEW_TYPE_OAKB_REVIEW, active: true });
      leaf = rightLeaf;
    }
    workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof OakbReviewView) await view.onOpen();
  }

  private folderFor(kind: 'auto' | 'reviewed' | 'canonical'): string {
    const s = this.settings;
    if (kind === 'auto') return `${s.knowledgeRoot}/${s.autoFolder}`;
    if (kind === 'reviewed') return `${s.knowledgeRoot}/${s.reviewedFolder}`;
    return `${s.knowledgeRoot}/${s.canonicalFolder}`;
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = path.replace(/\/+$/, '');
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    await this.app.vault.createFolder(normalized);
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
    const destination = `${folder}/${file.name}`;
    if (destination === file.path) return file;
    await this.app.fileManager.renameFile(file, destination);
    const moved = this.app.vault.getAbstractFileByPath(destination);
    if (!(moved instanceof TFile)) throw new Error(`Moved note not found: ${destination}`);
    return moved;
  }

  async promoteCard(file: TFile, canonicalFolderOverride?: string): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const confidence = String(cache?.frontmatter?.confidence ?? 'low');
    if (confidence === 'low') {
      new Notice('Cannot promote: confidence is low.');
      return;
    }
    const destination = canonicalFolderOverride ?? this.folderFor('canonical');
    await this.updateFrontmatter(file, {
      status: 'canonical',
      review_by: this.settings.reviewer,
      reviewed_at: new Date().toISOString().slice(0, 10),
      governance_decision: 'promoted'
    });
    await this.move(file, destination);
  }

  async archiveCard(file: TFile, reason = 'manual governance decision'): Promise<void> {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const archiveFolder = `${this.settings.archiveRoot}/${stamp}`;
    await this.updateFrontmatter(file, {
      status: 'archive',
      archived_at: new Date().toISOString().slice(0, 10),
      archive_reason: reason,
      governance_decision: 'archived'
    });
    await this.move(file, archiveFolder);
  }
}
