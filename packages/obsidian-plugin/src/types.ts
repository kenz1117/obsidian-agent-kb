import { TFile } from 'obsidian';
import { GovernedCard } from './domain';

export interface OakbSettings {
  knowledgeRoot: string;
  autoFolder: string;
  reviewedFolder: string;
  canonicalFolder: string;
  archiveRoot: string;
  reviewer: string;
  staleDays: number;
  showScores: boolean;
}

export const DEFAULT_SETTINGS: OakbSettings = {
  knowledgeRoot: '03-knowledge',
  autoFolder: 'auto',
  reviewedFolder: 'reviewed',
  canonicalFolder: 'canonical',
  archiveRoot: '90-archive/governance/manual',
  reviewer: 'human',
  staleDays: 180,
  showScores: true
};

export interface CardSummary extends GovernedCard {
  file: TFile;
  basename: string;
  confidence: string;
  source: string;
  tags: string[];
  folderKind: 'reviewed' | 'auto';
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
