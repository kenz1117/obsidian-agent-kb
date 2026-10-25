import { App, Modal, TextAreaComponent } from 'obsidian';

export class ReasonModal extends Modal {
  private value = '';

  constructor(app: App, private title: string, private onSubmit: (reason: string) => Promise<void> | void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: this.title });
    const area = new TextAreaComponent(this.contentEl);
    area.setPlaceholder('Reason').setValue(this.value).onChange(value => this.value = value);
    area.inputEl.addClass('oakb-reason-input');
    const buttons = this.contentEl.createDiv({ cls: 'oakb-modal-actions' });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
    buttons.createEl('button', { text: '确认', cls: 'mod-cta' }).addEventListener('click', async () => {
      this.close();
      await this.onSubmit(this.value || this.title);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
