import { App, PluginSettingTab, Setting } from 'obsidian';
import ObsidianAgentKbPlugin from './main';
import { OakbSettings } from './types';
import { Locale, setLocale, t } from './i18n';

export class OakbSettingTab extends PluginSettingTab {
  private plugin: ObsidianAgentKbPlugin;

  constructor(app: App, plugin: ObsidianAgentKbPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: t('settingsTitle') });

    const fields: Array<[keyof OakbSettings, string, string]> = [
      ['knowledgeRoot', t('knowledgeRoot'), t('knowledgeRootDesc')],
      ['autoFolder', t('autoFolder'), t('autoFolderDesc')],
      ['reviewedFolder', t('reviewedFolder'), t('reviewedFolderDesc')],
      ['canonicalFolder', t('canonicalFolder'), t('canonicalFolderDesc')],
      ['archiveRoot', t('archiveRoot'), t('archiveRootDesc')],
      ['reviewer', t('reviewer'), t('reviewerDesc')]
    ];

    for (const [key, name, description] of fields) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addText(text => text
          .setValue(String(this.plugin.settings[key]))
          .onChange(async value => {
            (this.plugin.settings as any)[key] = value;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName(t('staleDays'))
      .setDesc(t('staleDaysDesc'))
      .addText(text => text
        .setValue(String(this.plugin.settings.staleDays))
        .onChange(async value => {
          const parsed = Number(value);
          this.plugin.settings.staleDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 180;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('language'))
      .setDesc(t('languageDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('auto', '自动 / Auto')
        .addOption('zh', '中文')
        .addOption('en', 'English')
        .setValue(this.plugin.settings.language)
        .onChange(async value => {
          this.plugin.settings.language = value as Locale;
          await this.plugin.saveSettings();
          setLocale(this.plugin.settings.language);
          this.display();
        }));

    new Setting(containerEl)
      .setName(t('showScores'))
      .setDesc('Display governance_score on review cards.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showScores)
        .onChange(async value => {
          this.plugin.settings.showScores = value;
          await this.plugin.saveSettings();
        }));
  }
}
