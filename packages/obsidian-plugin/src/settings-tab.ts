import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { OakbPluginApi } from './plugin-api';
import type { OakbSettings } from './types';
import { setLocale, t, type Locale } from './i18n';
import { normalizeFolderPath } from './domain';
import { writeStoredApiKey } from './runtime/decision';
import { DEFAULT_SETTINGS } from './types';

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
    containerEl.addClass('oakb-settings');

    this.renderStatusHero(containerEl);
    this.renderAgentAccess(containerEl);
    this.renderConnectionStatus(containerEl);
    this.renderAutoDecision(containerEl);
    this.renderKnowledgeReview(containerEl);
    this.renderVaultLayout(containerEl);
    this.renderPreferences(containerEl);
  }

  // ------------------------------------------------------------- hero ----

  private renderStatusHero(containerEl: HTMLElement): void {
    const state = this.plugin.getMcpState();
    const hero = containerEl.createDiv({ cls: 'oakb-hero-status' });

    const badge = hero.createDiv({ cls: `oakb-hero-status__badge is-${state.state}` });
    badge.createSpan({ cls: 'oakb-status__dot' });
    badge.createSpan({
      text: state.state === 'running'
        ? t('mcpRunning')
        : state.state === 'starting'
          ? t('mcpStarting')
          : state.state === 'error'
            ? t('mcpErrorState')
            : t('mcpStopped')
    });

    const body = hero.createDiv({ cls: 'oakb-hero-status__body' });
    body.createEl('p', { cls: 'oakb-hero-status__title', text: t('settingsTitle') });
    const desc = body.createEl('p', { cls: 'oakb-hero-status__desc' });
    desc.appendText(`${t('agentAccessDesc')} `);
    desc.createEl('code', { text: `127.0.0.1:${this.plugin.settings.mcpPort}` });

    if (state.error) {
      containerEl.createDiv({ cls: 'oakb-service-error', text: state.error });
    }
  }

  // ----------------------------------------------------- agent access ----

  private renderAgentAccess(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('agentAccess')).setHeading();

    const state = this.plugin.getMcpState();
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
  }

  // ----------------------------------------------- connection status ----

  private renderConnectionStatus(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('connectionStatus')).setHeading();
    containerEl.createEl('p', { text: t('restartAgentHint'), cls: 'setting-item-description' });

    new Setting(containerEl)
      .setName(t('testConnection'))
      .addButton(button => button
        .setButtonText(t('testConnection'))
        .setDisabled(!this.plugin.getMcpState().running)
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
      containerEl.createDiv({ cls: 'oakb-service-status is-running', text: `● ${this.connectionTestResult}` });
    }
    if (this.connectionTestError) {
      containerEl.createDiv({ cls: 'oakb-service-error', text: this.connectionTestError });
    }

    const container = containerEl.createDiv({ cls: 'oakb-connections' });
    void this.renderAgents(container);
  }

  private async renderAgents(container: HTMLElement): Promise<void> {
    const [agents, recent] = await Promise.all([
      this.plugin.getAgentStatuses(),
      this.plugin.getRecentConnections()
    ]);
    if (!container.isConnected) return;
    container.empty();

    container.createDiv({ cls: 'oakb-connection-heading', text: t('configuredAgents') });
    if (!agents.length) {
      container.createDiv({ cls: 'oakb-connection-empty', text: t('noDetectedAgents') });
    }
    const labels: Record<string, string> = {
      configured: t('configured'),
      needs_update: t('needsUpdate'),
      not_configured: t('notConfigured'),
      manual: t('manual'),
      error: t('configError')
    };
    for (const agent of agents) {
      const row = container.createDiv({ cls: `oakb-agent is-${agent.state.replace('_', '-')}` });
      const name = row.createDiv({ cls: 'oakb-agent__name' });
      name.createSpan({ text: agent.name });
      name.createSpan({ cls: 'oakb-agent__id', text: agent.agentId });
      row.createDiv({ cls: `oakb-agent__state is-${agent.state.replace('_', '-')}`, text: labels[agent.state] });
      const copy = row.createEl('button', { cls: 'oakb-agent__copy', text: t('copyAgentAddress') });
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
      row.createSpan({ cls: 'oakb-connection-name', text: `● ${connection.name}${version}` });
      row.createSpan({ cls: 'oakb-connection-time', text: new Date(connection.connectedAt).toLocaleString() });
    }
  }

  // ----------------------------------------------------- auto decision --

  private renderAutoDecision(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('autoDecision')).setHeading();
    containerEl.createEl('p', { text: t('autoDecisionDesc'), cls: 'setting-item-description' });

    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName(t('autoDecisionEnabled'))
      .setDesc(t('autoDecisionEnabledDesc'))
      .addToggle(toggle => toggle
        .setValue(s.autoDecisionEnabled)
        .onChange(async value => {
          s.autoDecisionEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (!s.autoDecisionEnabled) return;

    new Setting(containerEl)
      .setName(t('autoDecisionDryRun'))
      .setDesc(t('autoDecisionDryRunDesc'))
      .addToggle(toggle => toggle
        .setValue(s.autoDecisionDryRun)
        .onChange(async value => {
          s.autoDecisionDryRun = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionProvider'))
      .setDesc(t('autoDecisionProviderDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('bailian-decision', '决策模型 / Decision model')
        .addOption('openai-compatible', 'OpenAI 兼容 / OpenAI-compatible')
        .setValue(s.autoDecisionProvider)
        .onChange(async value => {
          s.autoDecisionProvider = value as typeof s.autoDecisionProvider;
          if (s.autoDecisionProvider === 'bailian-decision') {
            s.autoDecisionEndpoint = DEFAULT_SETTINGS.autoDecisionEndpoint;
            s.autoDecisionModel = DEFAULT_SETTINGS.autoDecisionModel;
          } else {
            s.autoDecisionEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
            s.autoDecisionModel = 'qwen-plus';
          }
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionEndpoint'))
      .setDesc(t('autoDecisionEndpointDesc'))
      .addText(text => text
        .setValue(s.autoDecisionEndpoint)
        .onChange(async value => {
          s.autoDecisionEndpoint = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionModel'))
      .setDesc(t('autoDecisionModelDesc'))
      .addText(text => text
        .setValue(s.autoDecisionModel)
        .onChange(async value => {
          s.autoDecisionModel = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionApiKeyEnv'))
      .setDesc(t('autoDecisionApiKeyEnvDesc'))
      .addText(text => text
        .setValue(s.autoDecisionApiKeyEnv)
        .onChange(async value => {
          s.autoDecisionApiKeyEnv = value.trim() || 'DASHSCOPE_API_KEY';
          await this.plugin.saveSettings();
        }));

    const keyState = containerEl.createDiv({ cls: 'oakb-service-status' });
    void this.plugin.hasDecisionApiKey().then(found => {
      keyState.setText(`${t('autoDecisionApiKey')}: ${found ? t('autoDecisionApiKeyStored') : t('autoDecisionApiKeyMissing')}`);
    });

    new Setting(containerEl)
      .setName(t('autoDecisionApiKey'))
      .setDesc(t('autoDecisionApiKeyDesc'))
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder('sk-…').onChange(async value => {
          await writeStoredApiKey(value.trim());
        });
      });

    new Setting(containerEl)
      .setName(t('autoDecisionThreshold'))
      .setDesc(t('autoDecisionThresholdDesc'))
      .addText(text => text
        .setValue(String(Math.round(s.autoDecisionThreshold * 100)))
        .onChange(async value => {
          const parsed = Number(value);
          const ratio = parsed > 1 ? parsed / 100 : parsed;
          s.autoDecisionThreshold = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0.85;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionAutoPromote'))
      .setDesc(t('autoDecisionAutoPromoteDesc'))
      .addToggle(toggle => toggle
        .setValue(s.autoDecisionAutoPromote)
        .onChange(async value => {
          s.autoDecisionAutoPromote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionAutoArchive'))
      .setDesc(t('autoDecisionAutoArchiveDesc'))
      .addToggle(toggle => toggle
        .setValue(s.autoDecisionAutoArchive)
        .onChange(async value => {
          s.autoDecisionAutoArchive = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionOnNewCard'))
      .setDesc(t('autoDecisionOnNewCardDesc'))
      .addToggle(toggle => toggle
        .setValue(s.autoDecisionOnNewCard)
        .onChange(async value => {
          s.autoDecisionOnNewCard = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('autoDecisionMaxItems'))
      .setDesc(t('autoDecisionMaxItemsDesc'))
      .addText(text => text
        .setValue(String(s.autoDecisionMaxItems))
        .onChange(async value => {
          const parsed = Number(value);
          s.autoDecisionMaxItems = Number.isFinite(parsed) && parsed > 0 ? Math.min(200, Math.floor(parsed)) : 20;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t('decisionTest'))
      .addButton(button => button
        .setButtonText(t('decisionTest'))
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const hasKey = await this.plugin.hasDecisionApiKey();
            if (!hasKey) throw new Error(t('decisionNoApiKey'));
            new Notice(t('decisionTestPassed'));
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          } finally {
            button.setDisabled(false);
          }
        }));
  }

  // ---------------------------------------------------- knowledge review --

  private renderKnowledgeReview(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('knowledgeReview')).setHeading();

    new Setting(containerEl)
      .setName(t('reviewer'))
      .setDesc(t('reviewerDesc'))
      .addText(text => text
        .setValue(String(this.plugin.settings.reviewer))
        .onChange(async value => {
          const normalized = value.trim();
          if (!normalized) return;
          this.plugin.settings.reviewer = normalized;
          await this.plugin.saveSettings();
        }));

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
      .setName(t('showScores'))
      .setDesc(t('scoresDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showScores)
        .onChange(async value => {
          this.plugin.settings.showScores = value;
          await this.plugin.saveSettings();
        }));
  }

  // -------------------------------------------------------- vault layout --

  private renderVaultLayout(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('vaultLayout')).setHeading();

    const fields: Array<[keyof OakbSettings, string, string]> = [
      ['knowledgeRoot', t('knowledgeRoot'), t('knowledgeRootDesc')],
      ['autoFolder', t('autoFolder'), t('autoFolderDesc')],
      ['reviewedFolder', t('reviewedFolder'), t('reviewedFolderDesc')],
      ['canonicalFolder', t('canonicalFolder'), t('canonicalFolderDesc')],
      ['archiveRoot', t('archiveRoot'), t('archiveRootDesc')]
    ];

    const preview = containerEl.createDiv({ cls: 'oakb-folder-hint' });
    preview.setText(this.resolvePaths());

    for (const [key, name, description] of fields) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(description)
        .addText(text => text
          .setValue(String(this.plugin.settings[key]))
          .onChange(async value => {
            try {
              const normalized = normalizeFolderPath(value);
              if (!normalized) return;
              (this.plugin.settings as unknown as Record<keyof OakbSettings, unknown>)[key] = normalized;
              await this.plugin.saveSettings();
              preview.setText(this.resolvePaths());
            } catch {
              text.setValue(String(this.plugin.settings[key]));
            }
          }));
    }
  }

  private resolvePaths(): string {
    const s = this.plugin.settings;
    const join = (folder: string): string => [s.knowledgeRoot, folder].filter(Boolean).join('/');
    return [
      `${t('queueAuto')} → ${join(s.autoFolder)}`,
      `${t('queueReview')} → ${join(s.reviewedFolder)}`,
      `${t('queueCanonical')} → ${join(s.canonicalFolder)}`,
      `${t('queueArchive')} → ${s.archiveRoot}`
    ].join('\n');
  }

  // --------------------------------------------------------- preferences --

  private renderPreferences(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t('preferences')).setHeading();

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
  }
}
