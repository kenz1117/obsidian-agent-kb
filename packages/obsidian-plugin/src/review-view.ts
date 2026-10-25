import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import ObsidianAgentKbPlugin from './main';
import { CardSummary } from './types';

export const VIEW_TYPE_OAKB_REVIEW = 'oakb-review-view';

export class OakbReviewView extends ItemView {
  private plugin: ObsidianAgentKbPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianAgentKbPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string { return VIEW_TYPE_OAKB_REVIEW; }
  getDisplayText(): string { return 'Knowledge Review'; }
  getIcon(): string { return 'database'; }

  async onOpen(): Promise<void> {
    await this.renderQueue();
  }

  async onClose(): Promise<void> {}

  private folder(kind: 'reviewed' | 'auto'): string {
    const s = this.plugin.settings;
    return kind === 'reviewed' ? `${s.knowledgeRoot}/${s.reviewedFolder}` : `${s.knowledgeRoot}/${s.autoFolder}`;
  }

  private async cards(): Promise<CardSummary[]> {
    const reviewed = this.folder('reviewed');
    const auto = this.folder('auto');
    const files = this.app.vault.getMarkdownFiles().filter(file => {
      return file.path.startsWith(`${reviewed}/`) || file.path.startsWith(`${auto}/`);
    });

    const cards: CardSummary[] = [];
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm: Record<string, any> = cache?.frontmatter ?? {};
      const folderKind: 'reviewed' | 'auto' = file.path.startsWith(`${reviewed}/`) ? 'reviewed' : 'auto';
      cards.push({
        file,
        path: file.path,
        basename: file.basename,
        status: String(fm.status ?? 'unknown'),
        score: typeof fm.governance_score === 'number' ? fm.governance_score : null,
        confidence: String(fm.confidence ?? 'unknown'),
        source: String(fm.source ?? ''),
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        title: String(fm.title ?? file.basename),
        folderKind
      });
    }

    return cards.sort((a, b) => {
      const rank = a.folderKind === b.folderKind ? 0 : a.folderKind === 'reviewed' ? -1 : 1;
      if (rank !== 0) return rank;
      return (b.score ?? -1) - (a.score ?? -1);
    });
  }

  private async renderQueue(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('oakb-review');

    const header = root.createDiv({ cls: 'oakb-header' });
    const title = header.createDiv({ cls: 'oakb-title', text: 'Knowledge Review' });
    title.addClass('oakb-title');
    const actions = header.createDiv({ cls: 'oakb-header-actions' });
    actions.createEl('button', { text: 'Refresh', cls: 'mod-cta' }).addEventListener('click', async () => {
      await this.renderQueue();
    });

    try {
      const cards = await this.cards();
      const summary = root.createDiv({ cls: 'oakb-summary' });
      summary.createSpan({ text: `${cards.length} candidate card${cards.length === 1 ? '' : 's'}` });

      if (cards.length === 0) {
        root.createDiv({ cls: 'oakb-empty', text: 'No reviewed or auto knowledge cards found.' });
        return;
      }

      const list = root.createDiv({ cls: 'oakb-list' });
      for (const card of cards) {
        const item = list.createDiv({ cls: 'oakb-card' });
        const main = item.createDiv({ cls: 'oakb-card-main' });
        const titleEl = main.createDiv({ cls: 'oakb-card-title', text: card.title });
        titleEl.addEventListener('click', async () => {
          const leaf = this.app.workspace.getLeaf('tab');
          await leaf.openFile(card.file);
        });

        const meta = main.createDiv({ cls: 'oakb-card-meta' });
        meta.createSpan({ text: `status: ${card.status}` });
        meta.createSpan({ text: `confidence: ${card.confidence}` });
        if (this.plugin.settings.showScores && card.score !== null) {
          meta.createSpan({ text: `score: ${card.score}` });
        }
        meta.createSpan({ text: card.path });

        const buttons = item.createDiv({ cls: 'oakb-card-actions' });
        buttons.createEl('button', { text: 'Open' }).addEventListener('click', async () => {
          await this.app.workspace.getLeaf('tab').openFile(card.file);
        });
        buttons.createEl('button', { text: 'Promote', cls: 'mod-cta' }).addEventListener('click', async () => {
          await this.plugin.promoteCard(card.file, `${this.plugin.settings.knowledgeRoot}/${this.plugin.settings.canonicalFolder}`);
          new Notice('Knowledge card promoted.');
          await this.renderQueue();
        });
        buttons.createEl('button', { text: 'Archive' }).addEventListener('click', async () => {
          await this.plugin.archiveCard(card.file);
          new Notice('Knowledge card archived.');
          await this.renderQueue();
        });
      }
    } catch (error) {
      console.error(error);
      root.createDiv({ cls: 'oakb-error', text: `Failed to load review queue: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}
