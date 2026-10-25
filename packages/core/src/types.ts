export type KnowledgeStatus =
  | 'pending'
  | 'intake'
  | 'auto'
  | 'review'
  | 'canonical'
  | 'stale'
  | 'archive'
  | 'purge';

export type Sensitivity =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'personal'
  | 'secret';

export type IntakeDecision =
  | 'accept'
  | 'review'
  | 'temporary'
  | 'archive'
  | 'reject';

export interface GovernanceMetadata {
  id: string;
  type: string;
  title: string;
  status: KnowledgeStatus | string;
  source: string;
  origin: string;
  confidence: 'low' | 'medium' | 'high';
  sensitivity: Sensitivity;
  owner?: string;
  created: string;
  updated: string;
  reviewed_at?: string;
  review_by?: string;
  retention?: string;
  expires_at?: string;
  tags: string[];
}

export interface Provenance {
  origin: 'agent' | 'human' | 'connector' | 'importer';
  agent_id?: string;
  task_id?: string;
  model?: string;
  source_path?: string;
  prompt_hash?: string;
  reviewed_by?: 'human' | 'governance-engine' | 'none';
}

export interface GovernanceObject {
  metadata: GovernanceMetadata;
  body: string;
  provenance?: Provenance;
  bodyHash?: string;
  contentHash?: string;
}

export interface GovernancePolicy {
  version: number;
  intake: {
    allowed_types: string[];
    max_body_bytes: number;
    reject_if_missing: string[];
  };
  sensitivity: {
    default: Sensitivity;
    reject: Sensitivity[];
    require_review: Sensitivity[];
  };
  duplicate: Record<string, unknown>;
  quality: {
    min_review_score: number;
    min_canonical_score: number;
    weights: Record<
      | 'provenance'
      | 'actionability'
      | 'uniqueness'
      | 'evidence'
      | 'freshness'
      | 'specificity'
      | 'sensitivity_safety',
      number
    >;
  };
  routing: Record<string, string>;
  retention: Record<string, number>;
  promotion: Record<string, unknown>;
  purge: Record<string, unknown>;
}
