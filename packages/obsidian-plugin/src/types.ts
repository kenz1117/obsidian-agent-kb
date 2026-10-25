import { TFile } from 'obsidian';
import type { Locale } from './i18n';
import type { GovernedCard, QueueName } from './domain';

export interface OakbSettings {
  knowledgeRoot: string;
  autoFolder: string;
  reviewedFolder: string;
  canonicalFolder: string;
  archiveRoot: string;
  reviewer: string;
  staleDays: number;
  showScores: boolean;
  language: Locale;
  initialized: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
  agentTokens: Record<string, string>;
}

export const DEFAULT_SETTINGS: OakbSettings = {
  knowledgeRoot: '03-knowledge',
  autoFolder: 'auto',
  reviewedFolder: 'reviewed',
  canonicalFolder: 'canonical',
  archiveRoot: '90-archive/governance/manual',
  reviewer: 'human',
  staleDays: 180,
  showScores: true,
  language: 'zh',
  initialized: false,
  mcpEnabled: true,
  mcpPort: 27183,
  mcpToken: '',
  agentTokens: {}
};

export interface CardSummary extends GovernedCard {
  file: TFile;
  basename: string;
  confidence: string;
  source: string;
  tags: string[];
  governanceIssues: string[];
}

export interface OakbReviewState {
  queue: QueueName;
  query: string;
  minScore: number | null;
  confidence: string;
  selectedPath: string | null;
}

export type { QueueName };
