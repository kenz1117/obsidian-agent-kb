import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type { OakbPluginApi } from './plugin-api';
import type { CardSummary, QueueName } from './types';
import { t, type MessageKey } from './i18n';
import { duplicateGroups, filterCards, governanceStats, isStale, normalizeFolderPath, queueForCard } from './domain';
import { ReasonModal } from './reason-modal';

export const VIEW_TYPE_OAKB_REVIEW = 'oakb-review-view';
const QUEUES = [
  { id: 'review', labelKey: 'queueReview' },
  { id: 'auto', labelKey: 'queueAuto' },
  { id: 'conflicts', labelKey: 'queueConflicts' },
  { id: 'canonical', labelKey: 'queueCanonical' },
  { id: 'archive', labelKey: 'queueArchive' },
  { id: 'stale', labelKey: 'queueStale' }
] as const satisfies ReadonlyArray<{ id: QueueName; labelKey: MessageKey }>;

export class OakbReviewView extends ItemView {
  private plugin: OakbPluginApi;
  private queue: QueueName = 'review';
  private query = '';
  private minScore: number | null = null;
  private confidence = '';
  private selectedPath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OakbPluginApi) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string { return VIEW_TYPE_OAKB_REVIEW; }
  getDisplayText(): string { return t('knowledgeReview'); }
  getIcon(): string { return 'database'; }

  async onOpen(): Promise<void> { await this.renderQueue(); }
  async onClose(): Promise<void> {}

  private async allCards(): Promise<CardSummary[]> {
    return this.plugin.collectCards();
  }

  private visibleCards(cards: CardSummary[]): CardSummary[] {
    return filterCards(
      cards.filter(card => queueForCard(card, this.plugin.settings) === this.queue),
      { query: this.query, minScore: this.minScore, confidence: this.confidence }
    );
  }

  async renderQueue(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('oakb-review');

    const header = root.createDiv({ cls: 'oakb-header' });
    header.createDiv({ cls: 'oakb-title', text: t('knowledgeReview') });
    const actions = header.createDiv({ cls: 'oakb-header-actions' });
    const settings = actions.createEl('button', {
      cls: 'oakb-icon-button',
      attr: { 'aria-label': t('openSettings'), title: t('openSettings') }
    });
    setIcon(settings, 'settings');
    settings.addEventListener('click', () => this.plugin.openSettings());
    actions.createEl('button', { text: t('refresh') }).addEventListener('click', async () => await this.renderQueue());

    await this.renderConnectionSummary(root);

    try {
      const all = await this.allCards();
      const stats = governanceStats(all, this.plugin.settings);
      const conflicts = duplicateGroups(all).flat();
      stats.conflicts = Math.max(stats.conflicts, conflicts.length);

      const tabs = root.createDiv({ cls: 'oakb-tabs' });
      for (const queue of QUEUES) {
        const button = tabs.createEl('button', { text: `${t(queue.labelKey)} (${stats[queue.id]})`, cls: 'oakb-tab' });
        if (this.queue === queue.id) button.addClass('is-active');
        button.addEventListener('click', async () => {
          this.queue = queue.id;
          await this.renderQueue();
        });
      }

      const controls = root.createDiv({ cls: 'oakb-controls' });
      const search = controls.createEl('input', { type: 'search', placeholder: t('searchPlaceholder'), cls: 'oakb-search' });
      search.value = this.query;
      search.addEventListener('input', async () => {
        this.query = search.value;
        await this.renderList(all);
      });

      const score = controls.createEl('input', { type: 'number', placeholder: t('minScore') });
      score.min = '0';
      score.max = '100';
      score.value = this.minScore === null ? '' : String(this.minScore);
      score.addEventListener('input', async () => {
        this.minScore = score.value === '' ? null : Math.max(0, Math.min(100, Number(score.value)));
        await this.renderList(all);
      });

      const confidence = controls.createDiv({ cls: 'oakb-confidence' });
      const confidenceOptions = ['', 'high', 'medium', 'low'];
      for (const option of confidenceOptions) {
        const button = confidence.createEl('button', { text: option || 'All', cls: this.confidence === option ? 'is-active' : '' });
        button.addEventListener('click', async () => {
          this.confidence = option;
          await this.renderList(all);
        });
      }

      if (this.queue === 'conflicts') {
        const conflictPanel = root.createDiv({ cls: 'oakb-conflicts' });
        conflictPanel.createDiv({ cls: 'oakb-section-title', text: t('duplicateGroups') });
        const groups = duplicateGroups(all);
        if (!groups.length) conflictPanel.createDiv({ text: t('noDuplicateGroups') });
        for (const group of groups) {
          const item = conflictPanel.createDiv({ cls: 'oakb-conflict-group' });
          for (const card of group) {
            item.createDiv({ text: `${card.title} — ${card.path}` });
          }
        }
      }

      await this.renderList(all);
    } catch (error) {
      console.error(error);
      root.createDiv({ cls: 'oakb-error', text: `${t('loadFailed')} ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private async renderConnectionSummary(root: HTMLElement): Promise<void> {
    const state = this.plugin.getMcpState();
    const summary = root.createDiv({
      cls: state.running ? 'oakb-panel-connection is-running' : 'oakb-panel-connection',
      attr: { title: t('openSettings') }
    });
    summary.addEventListener('click', () => this.plugin.openSettings());
    try {
      const [agents, recent] = await Promise.all([
        this.plugin.getAgentStatuses(),
        this.plugin.getRecentConnections()
      ]);
      const configured = agents.filter(agent => agent.state === 'configured').length;
      summary.createDiv({
        text: `${state.running ? '●' : '○'} ${state.running ? t('mcpRunning') : t('mcpStopped')} · ${configured} ${t('configuredSummary')}`
      });
      if (recent.length) {
        summary.createDiv({
          cls: 'oakb-panel-last-connection',
          text: `${t('lastConnection')}: ${recent[0].name} · ${new Date(recent[0].connectedAt).toLocaleString()}`
        });
      } else {
        summary.createDiv({ cls: 'oakb-panel-last-connection', text: t('noAgentConnections') });
      }
    } catch {
      summary.setText(state.running ? t('mcpRunning') : t('mcpStopped'));
    }
  }

  private async renderList(all: CardSummary[]): Promise<void> {
    let list = this.contentEl.querySelector('.oakb-list');
    if (!list) {
      list = this.contentEl.createDiv({ cls: 'oakb-list' });
    }
    list.empty();
    const cards = this.visibleCards(all);
    if (!cards.length) {
      list.createDiv({ cls: 'oakb-empty', text: t('noMatch') });
      return;
    }

    for (const card of cards) {
      const stale = isStale(card, this.plugin.settings.staleDays);
      const item = list.createDiv({ cls: 'oakb-card' });
      if (this.selectedPath === card.path) item.addClass('is-selected');

      const main = item.createDiv({ cls: 'oakb-card-main' });
      const title = main.createDiv({ cls: 'oakb-card-title', text: card.title });
      title.addEventListener('click', async () => {
        this.selectedPath = this.selectedPath === card.path ? null : card.path;
        await this.renderList(all);
      });

      const meta = main.createDiv({ cls: 'oakb-card-meta' });
      meta.createSpan({ text: `${t('status')}: ${card.status}` });
      meta.createSpan({ text: `${t('confidence')}: ${card.confidence}` });
      if (this.plugin.settings.showScores && card.score !== null) meta.createSpan({ text: `${t('score')}: ${card.score}` });
      meta.createSpan({ text: `${t('updated')}: ${card.updated || t('none')}` });
      if (stale) meta.createSpan({ text: t('stale'), cls: 'oakb-flag' });
      if (card.duplicateOf) meta.createSpan({ text: `${t('duplicateOf')}: ${card.duplicateOf}`, cls: 'oakb-flag' });
      if (card.governanceIssues.length) meta.createSpan({ text: `${t('issues')}: ${card.governanceIssues.length}`, cls: 'oakb-flag' });

      const buttons = item.createDiv({ cls: 'oakb-card-actions' });
      buttons.createEl('button', { text: t('open') }).addEventListener('click', async () => await this.app.workspace.getLeaf('tab').openFile(card.file));
      buttons.createEl('button', { text: t('source') }).addEventListener('click', async () => await this.plugin.openSource(card));

      if (card.status !== 'review' && card.status !== 'canonical') {
        buttons.createEl('button', { text: t('markReviewed') }).addEventListener('click', async () => {
          try {
            await this.plugin.markReviewed(card.file);
            new Notice(t('reviewedNotice'));
            await this.renderQueue();
          } catch (error) {
            new Notice(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      }
      if (card.status !== 'canonical') {
        buttons.createEl('button', { text: t('promote'), cls: 'mod-cta' }).addEventListener('click', async () => {
          try {
            const promoted = await this.plugin.promoteCard(card.file, `${normalizeFolderPath(this.plugin.settings.knowledgeRoot)}/${normalizeFolderPath(this.plugin.settings.canonicalFolder)}`);
            if (promoted) new Notice(t('promoteSuccess'));
            await this.renderQueue();
          } catch (error) {
            new Notice(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      }
      buttons.createEl('button', { text: t('archive') }).addEventListener('click', async () => {
        new ReasonModal(this.app, 'Archive knowledge card', async reason => {
          await this.plugin.archiveCard(card.file, reason);
          new Notice(t('archiveSuccess'));
          await this.renderQueue();
        }).open();
      });

      if (this.selectedPath === card.path) {
        const detail = item.createDiv({ cls: 'oakb-card-detail' });
        detail.createDiv({ text: `${t('path')}: ${card.path}` });
        detail.createDiv({ text: `${t('sourceLabel')}: ${card.source || t('none')}` });
        detail.createDiv({ text: `${t('tags')}: ${card.tags.length ? card.tags.join(', ') : t('none')}` });
        if (card.governanceIssues.length) detail.createDiv({ text: `${t('issues')}: ${card.governanceIssues.join('; ')}` });
      }
    }
  }
}
