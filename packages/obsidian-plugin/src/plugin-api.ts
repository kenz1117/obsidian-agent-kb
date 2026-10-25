import type { App, TFile } from 'obsidian';
import type { OakbSettings, CardSummary } from './types';

export interface OakbPluginApi {
  app: App;
  settings: OakbSettings;
  showScores: boolean;
  collectCards(): Promise<CardSummary[]>;
  openSource(card: CardSummary): Promise<void>;
  markReviewed(file: TFile): Promise<void>;
  promoteCard(file: TFile, canonicalFolderOverride?: string): Promise<void>;
  archiveCard(file: TFile, reason?: string): Promise<void>;
  resolveConflict(card: CardSummary): Promise<void>;
  saveSettings(): Promise<void>;
}
