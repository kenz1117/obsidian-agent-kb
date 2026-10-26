import { TFile } from 'obsidian';
import type { Locale } from './i18n';
import type { GovernedCard, QueueName } from './domain';
import type { DecisionProvider } from './runtime/decision';

export type OakbServiceState = 'stopped' | 'starting' | 'running' | 'error';

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
  autoDecisionEnabled: boolean;
  autoDecisionDryRun: boolean;
  autoDecisionProvider: DecisionProvider;
  autoDecisionEndpoint: string;
  autoDecisionModel: string;
  autoDecisionApiKeyEnv: string;
  autoDecisionThreshold: number;
  autoDecisionAutoPromote: boolean;
  autoDecisionAutoArchive: boolean;
  autoDecisionMaxItems: number;
  autoDecisionOnNewCard: boolean;
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
  agentTokens: {},
  autoDecisionEnabled: false,
  autoDecisionDryRun: true,
  autoDecisionProvider: 'bailian-decision',
  autoDecisionEndpoint: 'https://llm-aj5o4wkud4eywk1v.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone',
  autoDecisionModel: 'decision-model-preview',
  autoDecisionApiKeyEnv: 'DASHSCOPE_API_KEY',
  autoDecisionThreshold: 0.85,
  autoDecisionAutoPromote: false,
  autoDecisionAutoArchive: false,
  autoDecisionMaxItems: 20,
  autoDecisionOnNewCard: false
};

export interface CardSummary extends GovernedCard {
  file: TFile;
  basename: string;
  confidence: string;
  sensitivity: string;
  source: string;
  tags: string[];
  governanceIssues: string[];
  /** 对该知识正确性负责的人或组织。 */
  owner: string;
  /** 适用范围。 */
  scope: string;
  /** 存续状态：active / archived / retired。 */
  state: string;
  /** 失效日期。 */
  expiresAt: string;
  /** 所属通道。 */
  channel: string;
}

export interface OakbReviewState {
  queue: QueueName;
  query: string;
  minScore: number | null;
  confidence: string;
  selectedPath: string | null;
}

export type { QueueName };
