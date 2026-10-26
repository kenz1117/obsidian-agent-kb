import { App, Modal, TextAreaComponent } from 'obsidian';
import { t } from './i18n';

export class ReasonModal extends Modal {
  private value = '';

  constructor(app: App, private title: string, private onSubmit: (reason: string) => Promise<void> | void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass('oakb-modal');
    this.contentEl.createEl('h3', { cls: 'oakb-modal-title', text: this.title });
    const area = new TextAreaComponent(this.contentEl);
    area.setPlaceholder(t('reasonPlaceholder')).setValue(this.value).onChange(value => this.value = value);
    area.inputEl.addClass('oakb-reason-input');
    const buttons = this.contentEl.createDiv({ cls: 'oakb-modal-actions' });
    const cancel = buttons.createEl('button', { text: t('cancel') });
    cancel.addEventListener('click', () => this.close());
    const confirm = buttons.createEl('button', { text: t('confirm'), cls: 'mod-cta' });
    confirm.addEventListener('click', async () => {
      this.close();
      await this.onSubmit(this.value || this.title);
    });
    area.inputEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
