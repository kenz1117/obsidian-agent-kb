import { createHash } from 'node:crypto';
import type {
  GovernanceMetadata,
  GovernanceObject,
  GovernancePolicy,
  IntakeDecision,
  Provenance
} from './types.js';

export interface GovernanceResult {
  decision: IntakeDecision;
  score: number;
  reasons: string[];
  violations: string[];
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
  /\b(?:mysql|postgres|postgresql|mongodb(?:\+srv)?|redis):\/\/[^\s/:]+:[^\s@]+@/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/
];

export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function fingerprintObject(obj: GovernanceObject): {
  bodyHash: string;
  contentHash: string;
} {
  const bodyHash = hashText(obj.body);
  const contentHash = hashText(
    JSON.stringify({
      title: obj.metadata.title,
      tags: [...obj.metadata.tags].sort(),
      bodyHash
    })
  );
  return { bodyHash, contentHash };
}

export function detectSecrets(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * 判断力检测：内容里有没有"应该怎么做 / 为什么 / 什么情况下不适用"这类**判断**，
 * 而不仅仅是事实罗列或原始记录。
 *
 * 中英文都要覆盖——只匹配英文会让纯中文的知识卡全部判为"无判断"。
 */
const JUDGMENT_PATTERNS: RegExp[] = [
  // 中文情态与规范标记
  /必须|务必|严禁|禁止|不得|不可|不要|切勿|勿|不应|不该|应当|应该|需要|建议|推荐|优先|宁可|避免|防止|确保|保证/,
  // "应"单用太常见（响应、适应…），必须限定后面的动作动词
  /应(保留|声明|设置|使用|配置|读取|固定|统一|优先|先|为|是|与|保持|采用|符合|满足|包含|提供|区分|避免|遵循)/,
  // 因果与依据
  /因为|因此|所以|由于|原因是|理由是|依据是|基于/,
  // 规则、职责与边界
  /规则|约定|规范|约束|前提|条件|边界|限制|准则|标准|要求|职责|负责|决定/,
  // 方法与步骤
  /步骤|方法|流程|做法|如何|怎么/,
  // 失效与例外
  /风险|例外|除非|失效|过期|不适用|仅当|只有当|不作为/,
  // 默认与一致
  /默认|统一|一律|始终|总是|慎用|一致/,
  // 英文
  /\b(decide|decision|use|prefer|avoid|because|since|therefore|constraint|require|requires|required|must|should|shall|never|always|rule|method|steps?|risk|unless|except|default|only when|do not|don't|responsible for|determines)\b/i
];
/** 内容是否包含可复用的判断（而不只是信息或原始记录）。 */
export function hasJudgment(body: string): boolean {
  return JUDGMENT_PATTERNS.some((pattern) => pattern.test(body));
}

/** 从正文里提取"## 适用范围"段落，作为 scope 的候选值。 */
export function extractScope(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex(line => /^##\s*适用范围\s*$/.test(line.trim()));
  if (start < 0) return '';
  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index].trim())) break;
    collected.push(lines[index]);
  }
  return collected
    .join(' ')
    .replace(/^[-*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export interface AdmissionInput {
  metadata: GovernanceMetadata;
  body: string;
  now?: Date;
}

/**
 * 入库准入三道门。返回未通过的门（空数组 = 通过）。
 *
 * - 第一道门（来源与 Owner）：一票否决
 * - 第二道门（复用与去重）：一票否决
 * - 第三道门（正确性与结构化）：由评分与敏感度承担
 */
export function admissionBlockers(
  input: AdmissionInput,
  policy: GovernancePolicy
): string[] {
  const { metadata, body } = input;
  const now = input.now ?? new Date();
  const rules = policy.admission;
  const blockers: string[] = [];

  // ---- 第一道门：来源与 Owner（一票否决）----
  if (!metadata.source || metadata.source === 'unknown') {
    blockers.push('missing source');
  }
  if (rules.require_owner && !String(metadata.owner ?? '').trim()) {
    blockers.push('missing owner');
  }
  if (rules.require_scope && !String(metadata.scope ?? '').trim() && !extractScope(body)) {
    blockers.push('missing scope');
  }
  if (rules.expired_is_blocking && metadata.expires_at) {
    const expiry = Date.parse(metadata.expires_at);
    if (Number.isFinite(expiry) && expiry < now.getTime()) {
      blockers.push(`expired on ${metadata.expires_at}`);
    }
  }
  if (rules.reject_states.includes(String(metadata.state ?? 'active'))) {
    blockers.push(`state is ${metadata.state}`);
  }

  // ---- 第二道门：复用与去重（一票否决）----
  const duplicateOf = (metadata as unknown as Record<string, unknown>).duplicate_of;
  if (typeof duplicateOf === 'string' && duplicateOf.trim()) {
    blockers.push(`duplicate of ${duplicateOf}`);
  }

  // ---- 第三道门：正确性与结构化 ----
  if (rules.require_judgment && !hasJudgment(body)) {
    blockers.push('content contains no reusable judgment');
  }
  if (metadata.sensitivity === 'secret') {
    blockers.push('secret sensitivity is forbidden');
  }
  return blockers;
}

export function requiredMetadataMissing(
  metadata: GovernanceMetadata,
  policy: GovernancePolicy
): string[] {
  return policy.intake.reject_if_missing.filter((key) => {
    const value = (metadata as unknown as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  });
}

export function scoreGovernanceObject(
  obj: GovernanceObject,
  existingContentHashes: Set<string> = new Set()
): { score: number; breakdown: Record<string, number>; reasons: string[] } {
  const reasons: string[] = [];
  const weights = obj.metadata ? { ...obj.metadata } as never as never : undefined as never;
  void weights;

  const provenance = obj.provenance && obj.provenance.origin ? 20 : 0;
  if (provenance === 0) reasons.push('missing provenance');

  const body = obj.body.trim();
  const actionable = /\b(decide|decision|use|prefer|avoid|because|constraint|require|method|steps?|risk|rule)\b/i.test(body);
  const actionability = actionable ? 20 : body.length > 300 ? 10 : 0;
  if (actionability === 0) reasons.push('low actionability');

  const { contentHash } = fingerprintObject(obj);
  const uniqueness = existingContentHashes.has(contentHash) ? 0 : 15;
  if (uniqueness === 0) reasons.push('duplicate content');

  const evidence = obj.metadata.source && obj.metadata.source !== 'unknown' ? 15 : 0;
  if (evidence === 0) reasons.push('missing source evidence');

  const updated = Date.parse(obj.metadata.updated || '');
  const freshness = Number.isFinite(updated)
    ? Math.max(0, 10 - Math.floor((Date.now() - updated) / (1000 * 60 * 60 * 24 * 90)) * 2)
    : 0;
  if (freshness === 0) reasons.push('stale or missing updated date');

  const specificity = body.length > 800 ? 10 : body.length > 250 ? 7 : body.length > 80 ? 4 : 0;
  if (specificity === 0) reasons.push('too short or vague');

  const unsafe = detectSecrets(`${obj.body}\n${JSON.stringify(obj.metadata)}`);
  const sensitivitySafety = unsafe ? 0 : 10;
  if (unsafe) reasons.push('potential secret detected');

  const score =
    provenance +
    actionability +
    uniqueness +
    evidence +
    Math.max(0, Math.min(10, freshness)) +
    specificity +
    sensitivitySafety;

  return {
    score,
    breakdown: {
      provenance,
      actionability,
      uniqueness,
      evidence,
      freshness: Math.max(0, Math.min(10, freshness)),
      specificity,
      sensitivity_safety: sensitivitySafety
    },
    reasons
  };
}

export function evaluateIntake(
  obj: GovernanceObject,
  policy: GovernancePolicy,
  existingContentHashes: Set<string> = new Set()
): GovernanceResult {
  const violations: string[] = [];
  const reasons: string[] = [];

  if (!policy.intake.allowed_types.includes(obj.metadata.type)) {
    violations.push(`type not allowed: ${obj.metadata.type}`);
  }

  const missing = requiredMetadataMissing(obj.metadata, policy);
  if (missing.length) violations.push(`missing metadata: ${missing.join(', ')}`);

  const serialized = JSON.stringify(obj);
  if (serialized.length > policy.intake.max_body_bytes) {
    violations.push('object exceeds max_body_bytes');
  }

  if (obj.metadata.sensitivity && policy.sensitivity.reject.includes(obj.metadata.sensitivity)) {
    violations.push(`sensitivity rejected: ${obj.metadata.sensitivity}`);
  }

  if (detectSecrets(`${obj.body}\n${JSON.stringify(obj.metadata)}`)) violations.push('potential secret detected');

  const scored = scoreGovernanceObject(obj, existingContentHashes);
  reasons.push(...scored.reasons);

  let decision: IntakeDecision;
  if (violations.length) {
    decision = 'reject';
  } else if (scored.score < 40) {
    decision = 'archive';
  } else if (scored.score < 60) {
    decision = 'temporary';
  } else if (
    scored.score < policy.quality.min_canonical_score ||
    policy.sensitivity.require_review.includes(obj.metadata.sensitivity)
  ) {
    decision = 'review';
  } else {
    decision = 'review';
  }

  return {
    decision,
    score: scored.score,
    reasons,
    violations
  };
}

export function canPromote(
  obj: GovernanceObject,
  result: GovernanceResult,
  policy: GovernancePolicy
): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (result.decision === 'reject') reasons.push('intake was rejected');
  if (result.score < policy.quality.min_canonical_score) {
    reasons.push(`score below canonical threshold: ${result.score}`);
  }

  if (policy.promotion.require_provenance && !obj.provenance) {
    reasons.push('provenance required');
  }

  if (policy.promotion.require_source && !obj.metadata.source) {
    reasons.push('source required');
  }

  const confidenceOk =
    obj.metadata.confidence === 'medium' || obj.metadata.confidence === 'high';
  if (!confidenceOk) reasons.push('confidence too low');

  return {
    allowed: reasons.length === 0,
    reasons
  };
}

export function provenanceHash(provenance: Provenance): string {
  return hashText(JSON.stringify(provenance, Object.keys(provenance).sort()));
}
