import { App, Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import type { AutoDecisionPlan } from './runtime/decision';

/** Shows the model's judgement and, when allowed, lets the human apply it. */
export class DecisionModal extends Modal {
  constructor(
    app: App,
    private readonly plan: AutoDecisionPlan,
    private readonly onPromote: () => Promise<void> | void,
    private readonly onArchive: () => Promise<void> | void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('oakb-modal');
    contentEl.addClass('oakb-decision-modal');

    contentEl.createEl('h3', { cls: 'oakb-modal-title', text: t('decisionModalTitle') });

    const outcome = this.plan.outcome;
    const verdict = this.plan.action === 'promote'
      ? t('decisionPromotable')
      : this.plan.action === 'archive'
        ? t('decisionNotPromotable')
        : outcome.needsHumanReview
          ? t('decisionNeedsHuman')
          : t('decisionNotPromotable');
    const tone = this.plan.action === 'promote' ? 'ok' : this.plan.action === 'archive' ? 'bad' : 'warn';
    contentEl.createDiv({ cls: `oakb-decision-verdict is-${tone}`, text: verdict });

    const grid = contentEl.createDiv({ cls: 'oakb-decision-grid' });
    const row = (label: string, value: string): void => {
      grid.createDiv({ cls: 'oakb-decision-cell' });
      grid.lastElementChild?.createDiv({ cls: 'oakb-decision-label', text: label });
      grid.lastElementChild?.createDiv({ cls: 'oakb-decision-value', text: value });
    };
    row(t('decisionConfidence'), `${(outcome.confidence * 100).toFixed(0)}%`);
    row(t('decisionQuality'), String(Math.round(outcome.qualityScore)));
    row(t('decisionCategory'), outcome.category);
    row('Model', outcome.model);

    const reason = contentEl.createDiv({ cls: 'oakb-decision-reason' });
    reason.createDiv({ cls: 'oakb-decision-label', text: t('decisionReason') });
    reason.createDiv({ cls: 'oakb-decision-value', text: this.plan.reason || outcome.reason || '—' });

    if (this.plan.blockers.length) {
      const blockers = contentEl.createDiv({ cls: 'oakb-decision-blockers' });
      blockers.createDiv({ cls: 'oakb-decision-label', text: t('issues') });
      blockers.createDiv({ cls: 'oakb-decision-value', text: this.plan.blockers.join('；') });
    }

    const actions = contentEl.createDiv({ cls: 'oakb-modal-actions' });
    const close = actions.createEl('button', { text: t('cancel') });
    close.addEventListener('click', () => this.close());

    if (this.plan.action === 'promote') {
      const promote = actions.createEl('button', { text: t('decisionPromoteNow'), cls: 'mod-cta' });
      promote.addEventListener('click', async () => {
        this.close();
        await this.onPromote();
      });
    }
    if (this.plan.action !== 'promote') {
      const archive = actions.createEl('button', { text: t('decisionArchiveNow') });
      archive.addEventListener('click', async () => {
        this.close();
        await this.onArchive();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
