import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type { OakbPluginApi } from './plugin-api';
import type { CardSummary, QueueName } from './types';
import { t, tStatus, type MessageKey } from './i18n';
import { duplicateGroups, filterCards, governanceStats, isStale, normalizeFolderPath, queueForCard } from './domain';
import { ReasonModal } from './reason-modal';
import { DecisionModal } from './decision-modal';

export const VIEW_TYPE_OAKB_REVIEW = 'oakb-review-view';
const QUEUES = [
  { id: 'review', labelKey: 'queueReview', icon: 'inbox' },
  { id: 'auto', labelKey: 'queueAuto', icon: 'sparkles' },
  { id: 'conflicts', labelKey: 'queueConflicts', icon: 'alert-triangle' },
  { id: 'canonical', labelKey: 'queueCanonical', icon: 'shield-check' },
  { id: 'archive', labelKey: 'queueArchive', icon: 'archive' },
  { id: 'stale', labelKey: 'queueStale', icon: 'clock' }
] as const satisfies ReadonlyArray<{ id: QueueName; labelKey: MessageKey; icon: string }>;

export class OakbReviewView extends ItemView {
  private plugin: OakbPluginApi;
  private queue: QueueName = 'review';
  private query = '';
  private minScore: number | null = null;
  private confidence = '';
  private selectedPath: string | null = null;

  private cards: CardSummary[] = [];
  private built = false;
  private statValues = new Map<QueueName, HTMLElement>();
  private statButtons = new Map<QueueName, HTMLButtonElement>();
  private statusEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private conflictsEl: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;
  private batchButton: HTMLButtonElement | null = null;
  private statusRenderToken = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OakbPluginApi) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string { return VIEW_TYPE_OAKB_REVIEW; }
  getDisplayText(): string { return t('knowledgeReview'); }
  getIcon(): string { return 'database'; }

  async onOpen(): Promise<void> {
    this.buildShell();
    this.unsubscribe = this.plugin.onServiceStateChange(() => { void this.renderStatus(); });
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
    this.built = false;
    this.statValues.clear();
    this.statButtons.clear();
    this.statusEl = null;
    this.listEl = null;
    this.conflictsEl = null;
    this.subtitleEl = null;
    this.batchButton = null;
  }

  /** Full refresh: rebuilds the shell once, then only refreshes the data. */
  async renderQueue(): Promise<void> {
    if (!this.built) this.buildShell();
    await this.refresh();
  }

  private buildShell(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('oakb-review');
    this.built = true;

    // ---------------------------------------------------------- hero ----
    const hero = root.createDiv({ cls: 'oakb-hero' });
    const heroRow = hero.createDiv({ cls: 'oakb-hero__row' });
    const heroBody = heroRow.createDiv();
    const title = heroBody.createEl('h2', { cls: 'oakb-hero__title' });
    setIcon(title.createSpan({ cls: 'oakb-hero__icon' }), 'database');
    title.createSpan({ text: t('knowledgeReview') });
    this.subtitleEl = heroBody.createDiv({ cls: 'oakb-hero__subtitle' });

    const actions = heroRow.createDiv({ cls: 'oakb-hero__actions' });
    const refreshButton = actions.createEl('button', {
      cls: 'oakb-icon-button',
      attr: { 'aria-label': t('refresh'), title: t('refresh') }
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', async () => {
      refreshButton.addClass('is-spinning');
      await this.refresh();
      refreshButton.removeClass('is-spinning');
    });
    const settingsButton = actions.createEl('button', {
      cls: 'oakb-icon-button',
      attr: { 'aria-label': t('openSettings'), title: t('openSettings') }
    });
    setIcon(settingsButton, 'settings');
    settingsButton.addEventListener('click', () => this.plugin.openSettings());

    const batch = actions.createEl('button', {
      cls: 'oakb-icon-button',
      attr: { 'aria-label': t('decisionRunAll'), title: t('decisionRunAll') }
    });
    setIcon(batch, 'sparkles');
    batch.addEventListener('click', async () => await this.runBatchDecision());
    this.batchButton = batch;

    // -------------------------------------------------------- status ----
    this.statusEl = hero.createDiv({
      cls: 'oakb-status',
      attr: { role: 'button', tabindex: '0', 'aria-label': t('openSettings'), title: t('openSettings') }
    });
    this.statusEl.addEventListener('click', () => this.plugin.openSettings());
    this.statusEl.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.plugin.openSettings();
      }
    });

    // -------------------------------------------------- stat tiles ----
    const stats = root.createDiv({ cls: 'oakb-stats', attr: { role: 'group', 'aria-label': t('queueLabel') } });
    for (const queue of QUEUES) {
      const button = stats.createEl('button', {
        cls: `oakb-stat oakb-stat--${queue.id}`,
        attr: { 'aria-pressed': 'false' }
      });
      const head = button.createSpan({ cls: 'oakb-stat__head' });
      const icon = head.createSpan({ cls: 'oakb-stat__icon' });
      setIcon(icon, queue.icon);
      const value = head.createSpan({ cls: 'oakb-stat__value', text: '0' });
      button.createSpan({ cls: 'oakb-stat__label', text: t(queue.labelKey) });
      button.addEventListener('click', async () => {
        this.queue = queue.id;
        this.selectedPath = null;
        await this.refresh();
      });
      this.statValues.set(queue.id, value);
      this.statButtons.set(queue.id, button);
    }

    // ------------------------------------------------------- toolbar ----
    const toolbar = root.createDiv({ cls: 'oakb-toolbar' });

    const search = toolbar.createEl('input', {
      type: 'search',
      cls: 'oakb-search',
      attr: { 'aria-label': t('searchPlaceholder'), placeholder: t('searchPlaceholder') }
    });
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      void this.renderList();
    });

    const score = toolbar.createEl('input', {
      type: 'number',
      cls: 'oakb-score',
      attr: { 'aria-label': t('minScore'), placeholder: t('minScore'), min: '0', max: '100' }
    });
    score.value = this.minScore === null ? '' : String(this.minScore);
    score.addEventListener('input', () => {
      this.minScore = score.value === '' ? null : Math.max(0, Math.min(100, Number(score.value)));
      void this.renderList();
    });

    const confidence = toolbar.createDiv({
      cls: 'oakb-segment',
      attr: { role: 'group', 'aria-label': t('confidence') }
    });
    for (const option of ['', 'high', 'medium', 'low']) {
      const button = confidence.createEl('button', {
        text: option || t('all'),
        attr: { 'aria-pressed': String(this.confidence === option) }
      });
      if (this.confidence === option) button.addClass('is-active');
      button.addEventListener('click', () => {
        this.confidence = option;
        for (const sibling of confidence.children) {
          const active = sibling === button;
          sibling.toggleClass('is-active', active);
          sibling.setAttribute('aria-pressed', String(active));
        }
        void this.renderList();
      });
    }

    // ------------------------------------------------------ content ----
    this.conflictsEl = root.createDiv({ cls: 'oakb-conflicts' });
    this.conflictsEl.hide();
    this.listEl = root.createDiv({ cls: 'oakb-list' });
  }

  private async refresh(): Promise<void> {
    try {
      this.cards = await this.plugin.collectCards();
    } catch (error) {
      console.error(error);
      if (this.listEl) {
        this.listEl.empty();
        this.listEl.createDiv({ cls: 'oakb-error', text: `${t('loadFailed')} ${error instanceof Error ? error.message : String(error)}` });
      }
      return;
    }

    const stats = governanceStats(this.cards, this.plugin.settings);
    const conflicts = duplicateGroups(this.cards).flat();
    stats.conflicts = Math.max(stats.conflicts, conflicts.length);

    for (const queue of QUEUES) {
      const value = this.statValues.get(queue.id);
      if (value) value.setText(String(stats[queue.id] ?? 0));
      const button = this.statButtons.get(queue.id);
      if (button) {
        button.toggleClass('is-active', this.queue === queue.id);
        button.setAttribute('aria-pressed', String(this.queue === queue.id));
      }
    }

    if (this.batchButton) {
      this.batchButton.toggleClass('is-hidden', !this.plugin.settings.autoDecisionEnabled);
      this.batchButton.hidden = !this.plugin.settings.autoDecisionEnabled;
    }

    if (this.subtitleEl) {
      this.subtitleEl.setText(t('knowledgeReviewSubtitle', {
        total: this.cards.length,
        queue: stats[this.queue] ?? 0
      }));
    }

    await this.renderStatus();
    this.renderConflicts();
    await this.renderList();
  }

  private async renderStatus(): Promise<void> {
    const el = this.statusEl;
    if (!el) return;
    // Overlapping renders (vault change + service state change) must not
    // append twice, so build into a fragment and swap it in only if this
    // render is still the newest one.
    const token = ++this.statusRenderToken;
    const draft = document.createElement('div');
    const state = this.plugin.getMcpState();
    draft.className = `oakb-status oakb-status--${state.state}`;
    draft.setAttribute('role', 'button');
    draft.setAttribute('tabindex', '0');
    draft.setAttribute('aria-label', t('openSettings'));
    draft.setAttribute('title', t('openSettings'));
    draft.createSpan({ cls: 'oakb-status__dot' });
    const label = draft.createSpan({ cls: 'oakb-status__label' });
    label.setText(state.state === 'running'
      ? t('mcpRunning')
      : state.state === 'starting'
        ? t('mcpStarting')
        : state.state === 'error'
          ? t('mcpErrorState')
          : t('mcpStopped'));
    draft.createSpan({ cls: 'oakb-status__spacer' });

    try {
      const [agents, recent] = await Promise.all([
        this.plugin.getAgentStatuses(),
        this.plugin.getRecentConnections()
      ]);
      const configured = agents.filter(agent => agent.state === 'configured').length;
      draft.createSpan({ text: `${configured} ${t('configuredSummary')}` });
      if (recent.length) {
        draft.createSpan({
          cls: 'oakb-status__hint',
          text: `${t('lastConnection')}: ${recent[0].name} · ${new Date(recent[0].connectedAt).toLocaleString()}`
        });
      } else {
        draft.createSpan({ cls: 'oakb-status__hint', text: t('noAgentConnections') });
      }
    } catch {
      draft.createSpan({ cls: 'oakb-status__hint', text: t('noAgentConnections') });
    }

    if (token !== this.statusRenderToken || this.statusEl !== el) return;
    el.empty();
    for (const child of Array.from(draft.childNodes)) el.appendChild(child);
  }

  private renderConflicts(): void {
    const panel = this.conflictsEl;
    if (!panel) return;
    if (this.queue !== 'conflicts') {
      panel.hide();
      return;
    }
    panel.empty();
    panel.show();
    panel.createDiv({ cls: 'oakb-section-title', text: t('duplicateGroups') });
    const groups = duplicateGroups(this.cards);
    if (!groups.length) {
      panel.createDiv({ cls: 'oakb-connection-empty', text: t('noDuplicateGroups') });
      return;
    }
    for (const group of groups) {
      const item = panel.createDiv({ cls: 'oakb-conflict-group' });
      for (const card of group) item.createDiv({ text: `${card.title} — ${card.path}` });
    }
  }

  private async runSingleDecision(card: CardSummary): Promise<void> {
    const notice = new Notice(t('decisionRunning'), 0);
    try {
      const plan = await this.plugin.decideCard(card);
      notice.hide();
      new DecisionModal(this.app, plan, async () => {
        const applied = await this.plugin.applyDecision(card, plan, true);
        new Notice(applied ? t('promoteSuccess') : t('error'));
        await this.refresh();
      }, async () => {
        const applied = await this.plugin.applyDecision(card, { ...plan, action: 'archive' }, true);
        new Notice(applied ? t('archiveSuccess') : t('error'));
        await this.refresh();
      }).open();
    } catch (error) {
      notice.hide();
      new Notice(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runBatchDecision(): Promise<void> {
    const cards = this.visibleCards();
    const limit = Math.max(1, Math.min(this.plugin.settings.autoDecisionMaxItems, cards.length));
    const notice = new Notice(t('decisionRunning'), 0);
    let promoted = 0;
    let archived = 0;
    let review = 0;
    const dryRun = this.plugin.settings.autoDecisionDryRun;
    try {
      for (const card of cards.slice(0, limit)) {
        const plan = await this.plugin.decideCard(card);
        if (plan.action === 'promote') {
          if (await this.plugin.applyDecision(card, plan)) promoted += 1;
          else if (dryRun) promoted += 1;
          else review += 1;
        } else if (plan.action === 'archive') {
          if (await this.plugin.applyDecision(card, plan)) archived += 1;
          else if (dryRun) archived += 1;
          else review += 1;
        } else {
          review += 1;
        }
      }
      notice.hide();
      new Notice(t('decisionBatchDone', { promoted, archived, review, dryRun }), 10000);
      await this.refresh();
    } catch (error) {
      notice.hide();
      new Notice(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private visibleCards(): CardSummary[] {
    return filterCards(
      this.cards.filter(card => queueForCard(card, this.plugin.settings) === this.queue),
      { query: this.query, minScore: this.minScore, confidence: this.confidence }
    );
  }

  private async renderList(): Promise<void> {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    const cards = this.visibleCards();
    if (!cards.length) {
      const empty = list.createDiv({ cls: 'oakb-empty' });
      const icon = empty.createDiv({ cls: 'oakb-empty__icon' });
      setIcon(icon, 'file-search');
      empty.createDiv({ cls: 'oakb-empty__title', text: t('emptyQueueTitle') });
      empty.createDiv({ cls: 'oakb-empty__hint', text: t('emptyQueueHint') });
      return;
    }

    for (const card of cards) {
      const item = list.createDiv({ cls: `oakb-card oakb-card--${this.queue}` });
      if (this.selectedPath === card.path) item.addClass('is-selected');

      const head = item.createDiv({ cls: 'oakb-card__head' });
      const title = head.createEl('button', { cls: 'oakb-card__title', text: card.title });
      title.setAttribute('title', card.title);
      title.setAttribute('aria-expanded', String(this.selectedPath === card.path));
      title.addEventListener('click', async () => {
        this.selectedPath = this.selectedPath === card.path ? null : card.path;
        await this.renderList();
      });

      const quick = head.createDiv({ cls: 'oakb-card__quick' });
      const open = quick.createEl('button', {
        cls: 'oakb-quick-button',
        attr: { 'aria-label': t('open'), title: t('open') }
      });
      setIcon(open, 'file-text');
      open.addEventListener('click', async () => await this.app.workspace.getLeaf('tab').openFile(card.file));

      if (card.status !== 'review' && card.status !== 'canonical') {
        const review = quick.createEl('button', {
          cls: 'oakb-quick-button',
          attr: { 'aria-label': t('markReviewed'), title: t('markReviewed') }
        });
        setIcon(review, 'check');
        review.addEventListener('click', async () => {
          try {
            await this.plugin.markReviewed(card.file);
            new Notice(t('reviewedNotice'));
            await this.refresh();
          } catch (error) {
            new Notice(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      }

      if (card.status !== 'canonical') {
        const promote = quick.createEl('button', {
          cls: 'oakb-quick-button mod-cta',
          attr: { 'aria-label': t('promote'), title: t('promote') }
        });
        setIcon(promote, 'shield-check');
        promote.addEventListener('click', async () => {
          try {
            const promoted = await this.plugin.promoteCard(card.file, `${normalizeFolderPath(this.plugin.settings.knowledgeRoot)}/${normalizeFolderPath(this.plugin.settings.canonicalFolder)}`);
            if (promoted) new Notice(t('promoteSuccess'));
            await this.refresh();
          } catch (error) {
            new Notice(`${t('error')}: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      }

      const archive = quick.createEl('button', {
        cls: 'oakb-quick-button',
        attr: { 'aria-label': t('archive'), title: t('archive') }
      });
      setIcon(archive, 'archive');
      archive.addEventListener('click', () => {
        new ReasonModal(this.app, t('archiveTitle'), async reason => {
          await this.plugin.archiveCard(card.file, reason);
          new Notice(t('archiveSuccess'));
          await this.refresh();
        }).open();
      });

      if (this.plugin.settings.autoDecisionEnabled) {
        const decide = quick.createEl('button', {
          cls: 'oakb-quick-button',
          attr: { 'aria-label': t('decisionRun'), title: t('decisionRun') }
        });
        setIcon(decide, 'sparkles');
        decide.addEventListener('click', async () => await this.runSingleDecision(card));
      }

      const badges = item.createDiv({ cls: 'oakb-card__badges' });
      badges.createSpan({ cls: 'oakb-badge oakb-badge--status', text: tStatus(card.status) });
      if (card.confidence && card.confidence !== 'unknown') {
        badges.createSpan({
          cls: `oakb-badge oakb-badge--confidence-${card.confidence}`,
          text: `${t('confidence')}: ${card.confidence}`
        });
      }
      if (this.plugin.settings.showScores && card.score !== null) {
        badges.createSpan({
          cls: `oakb-badge oakb-badge--score${card.score < 80 ? ' is-low' : ''}`,
          text: `${t('score')}: ${card.score}`
        });
      }
      badges.createSpan({ cls: 'oakb-badge', text: `${t('updated')}: ${card.updated || t('none')}` });
      if (isStale(card, this.plugin.settings.staleDays)) {
        badges.createSpan({ cls: 'oakb-badge oakb-badge--warning', text: t('stale') });
      }
      if (card.duplicateOf) {
        badges.createSpan({ cls: 'oakb-badge oakb-badge--danger', text: `${t('duplicateOf')}: ${card.duplicateOf}` });
      }
      if (card.governanceIssues.length) {
        badges.createSpan({ cls: 'oakb-badge oakb-badge--danger', text: `${t('issues')}: ${card.governanceIssues.length}` });
      }

      if (this.selectedPath === card.path) {
        const detail = item.createEl('dl', { cls: 'oakb-card__detail' });
        const row = (label: string, value: string): void => {
          detail.createEl('dt', { text: label });
          detail.createEl('dd', { text: value });
        };
        row(t('path'), card.path);
        row(t('sourceLabel'), card.source || t('none'));
        row(t('tags'), card.tags.length ? card.tags.join(', ') : t('none'));
        row(t('status'), card.status);
        if (card.governanceIssues.length) row(t('issues'), card.governanceIssues.join('; '));
      }
    }
  }
}
