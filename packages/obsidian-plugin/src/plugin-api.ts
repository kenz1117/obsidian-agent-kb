import type { App, Plugin, TFile } from 'obsidian';
import type { OakbSettings, CardSummary } from './types';
import type { AgentConnectionStatus } from './runtime/agent-config';
import type { ClientConnection } from './runtime/knowledge';

export interface OakbPluginApi extends Plugin {
  app: App;
  settings: OakbSettings;
  collectCards(): Promise<CardSummary[]>;
  openSource(card: CardSummary): Promise<void>;
  markReviewed(file: TFile): Promise<void>;
  promoteCard(file: TFile, canonicalFolderOverride?: string): Promise<boolean>;
  archiveCard(file: TFile, reason?: string): Promise<void>;
  resolveConflict(card: CardSummary): Promise<void>;
  saveSettings(): Promise<void>;
  getMcpState(): { running: boolean; url: string; error: string };
  setMcpEnabled(enabled: boolean): Promise<void>;
  restartMcp(): Promise<void>;
  connectAgents(): Promise<string>;
  copyMcpUrl(): Promise<void>;
  copyAgentUrl(agentId: string): Promise<void>;
  getAgentStatuses(): Promise<AgentConnectionStatus[]>;
  getRecentConnections(): Promise<ClientConnection[]>;
  testMcpConnection(): Promise<string>;
  openSettings(): void;
}
