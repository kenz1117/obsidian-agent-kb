import { createHash } from 'node:crypto';
import type {
  GovernanceMetadata,
  GovernanceObject,
  GovernancePolicy,
  IntakeDecision,
  Provenance
} from './types.ts';

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

  if (detectSecrets(serialized)) violations.push('potential secret detected');

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
