import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { OakbPluginApi } from './plugin-api';
import type { OakbSettings } from './types';
import { setLocale, t, type Locale } from './i18n';
import { normalizeFolderPath } from './domain';

export class OakbSettingTab extends PluginSettingTab {
  private plugin: OakbPluginApi;
  private connectionTestResult = '';
  private connectionTestError = '';

  constructor(app: App, plugin: OakbPluginApi) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: t('settingsTitle') });

    containerEl.createEl('h3', { text: t('agentAccess') });
    const state = this.plugin.getMcpState();
    containerEl.createEl('p', {
      text: `${state.running ? '● ' + t('mcpRunning') : '○ ' + t('mcpStopped')}。${t('agentAccessDesc')}`,
      cls: state.running ? 'oakb-service-status is-running' : 'oakb-service-status'
    });
    if (state.error) containerEl.createEl('p', { text: state.error, cls: 'oakb-service-error' });

    new Setting(containerEl)
      .setName(t('mcpEnabled'))
      .setDesc(t('mcpEnabledDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.mcpEnabled)
        .onChange(async value => {
          await this.plugin.setMcpEnabled(value);
          this.display();
        }));

    new Setting(containerEl)
      .setName(t('connectAgents'))
      .setDesc(t('connectAgentsDesc'))
      .addButton(button => button
        .setButtonText(t('connectAgents'))
        .setCta()
        .setDisabled(!state.running)
        .onClick(async () => {
          button.setDisabled(true);
          try {
            new Notice(await this.plugin.connectAgents(), 10000);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          } finally {
            this.display();
          }
        }));

    new Setting(containerEl)
      .setName(t('copyAgentAddress'))
      .setDesc(t('copyAgentAddressDesc'))
      .addButton(button => button
        .setButtonText(t('copyAgentAddress'))
        .setDisabled(!state.running)
        .onClick(async () => {
          try {
            await this.plugin.copyMcpUrl();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }));

    containerEl.createEl('h3', { text: t('connectionStatus') });
    containerEl.createEl('p', { text: t('restartAgentHint'), cls: 'setting-item-description' });
    new Setting(containerEl)
      .setName(t('testConnection'))
      .addButton(button => button
        .setButtonText(t('testConnection'))
        .setDisabled(!state.running)
        .onClick(async () => {
          button.setDisabled(true);
          try {
            this.connectionTestResult = await this.plugin.testMcpConnection();
            this.connectionTestError = '';
            new Notice(this.connectionTestResult);
          } catch (error) {
            this.connectionTestResult = '';
            this.connectionTestError = error instanceof Error ? error.message : String(error);
            new Notice(this.connectionTestError);
          } finally {
            this.display();
          }
        }));
    if (this.connectionTestResult) {
      containerEl.createEl('p', { text: `● ${this.connectionTestResult}`, cls: 'oakb-service-status is-running' });
    }
    if (this.connectionTestError) {
      containerEl.createEl('p', { text: this.connectionTestError, cls: 'oakb-service-error' });
    }
    const connectionStatus = containerEl.createDiv({ cls: 'oakb-connections' });
    void this.renderConnectionStatus(connectionStatus);

    containerEl.createEl('h3', { text: t('knowledgeReview') });

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
            try {
              const normalized = key === 'reviewer' ? value.trim() : normalizeFolderPath(value);
              if (key === 'reviewer' && !normalized) return;
              if (key !== 'reviewer' && !normalized) return;
              (this.plugin.settings as unknown as Record<keyof OakbSettings, unknown>)[key] = normalized;
              await this.plugin.saveSettings();
            } catch {
              text.setValue(String(this.plugin.settings[key]));
            }
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

  private async renderConnectionStatus(container: HTMLElement): Promise<void> {
    const [agents, recent] = await Promise.all([
      this.plugin.getAgentStatuses(),
      this.plugin.getRecentConnections()
    ]);
    if (!container.isConnected) return;
    container.empty();
    container.createDiv({ cls: 'oakb-connection-heading', text: t('configuredAgents') });
    if (!agents.length) container.createDiv({ cls: 'oakb-connection-empty', text: t('noDetectedAgents') });
    const labels = {
      configured: t('configured'),
      needs_update: t('needsUpdate'),
      not_configured: t('notConfigured'),
      manual: t('manual'),
      error: t('configError')
    };
    for (const agent of agents) {
      const row = container.createDiv({ cls: `oakb-connection-row is-${agent.state.replace('_', '-')}` });
      row.createSpan({ cls: 'oakb-connection-name', text: agent.name, title: `Agent ID: ${agent.agentId}` });
      row.createSpan({ cls: 'oakb-connection-state', text: labels[agent.state] });
      const copy = row.createEl('button', { cls: 'oakb-connection-copy', text: t('copyAgentAddress') });
      copy.disabled = !this.plugin.getMcpState().running;
      copy.addEventListener('click', () => {
        void this.plugin.copyAgentUrl(agent.agentId).catch(error => {
          new Notice(error instanceof Error ? error.message : String(error));
        });
      });
    }
    container.createDiv({ cls: 'oakb-connection-heading', text: t('recentConnections') });
    if (!recent.length) {
      container.createDiv({ cls: 'oakb-connection-empty', text: t('noAgentConnections') });
      return;
    }
    for (const connection of recent.slice(0, 5)) {
      const row = container.createDiv({ cls: 'oakb-connection-row is-connected' });
      const version = connection.version ? ` ${connection.version}` : '';
      row.createSpan({ cls: 'oakb-connection-name', text: `● ${connection.name}${version} · ${connection.agentId}` });
      row.createSpan({ cls: 'oakb-connection-time', text: new Date(connection.connectedAt).toLocaleString() });
    }
  }
}
