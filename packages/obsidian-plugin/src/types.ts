export interface OakbSettings {
  knowledgeRoot: string;
  autoFolder: string;
  reviewedFolder: string;
  canonicalFolder: string;
  archiveRoot: string;
  reviewer: string;
  showScores: boolean;
}

export const DEFAULT_SETTINGS: OakbSettings = {
  knowledgeRoot: '03-knowledge',
  autoFolder: 'auto',
  reviewedFolder: 'reviewed',
  canonicalFolder: 'canonical',
  archiveRoot: '90-archive/governance/manual',
  reviewer: 'human',
  showScores: true
};

export interface CardSummary {
  file: any;
  path: string;
  basename: string;
  status: string;
  score: number | null;
  confidence: string;
  source: string;
  tags: string[];
  title: string;
  folderKind: 'reviewed' | 'auto';
}
