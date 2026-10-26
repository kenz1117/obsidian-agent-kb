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

/** 知识内容所处的通道，决定它的治理单位与生命周期。 */
export type KnowledgeChannel =
  | 'knowledge'
  | 'agent-config'
  | 'memory'
  | 'task';

/** 知识的存续状态（与 status 的流程状态正交）。 */
export type KnowledgeState = 'active' | 'archived' | 'retired';

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
  /** 适用范围（该判断在什么场景下成立）。 */
  scope?: string;
  /** 版本号，用于区分同一知识的不同版本。 */
  version?: string;
  /** 生效日期。 */
  valid_from?: string;
  /** 存续状态：有效 / 已归档 / 已废止。 */
  state?: KnowledgeState;
  /** 所属通道：知识库 / Agent 配置 / 持久记忆 / 任务上下文。 */
  channel?: KnowledgeChannel;
  created: string;
  updated: string;
  reviewed_at?: string;
  review_by?: string;
  retention?: string;
  /** 失效日期，过期后不得作为权威依据。 */
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
  /** 入库准入门槛：来源与 Owner 门 / 复用去重门 / 正确性门。 */
  admission: {
    /** 缺少 Owner 一票否决。 */
    require_owner: boolean;
    /** 缺少适用范围一票否决。 */
    require_scope: boolean;
    /** 内容不含判断（只是资料/记录）一票否决。 */
    require_judgment: boolean;
    /** 这些存续状态不得作为权威依据。 */
    reject_states: string[];
    /** 超过失效日期即驳回。 */
    expired_is_blocking: boolean;
  };
  purge: Record<string, unknown>;
}
