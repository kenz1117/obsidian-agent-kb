import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateIntake } from './governance.ts';
import type { GovernanceObject, GovernancePolicy } from './types.ts';

const policy: GovernancePolicy = {
  version: 1,
  intake: {
    allowed_types: ['knowledge'],
    max_body_bytes: 100000,
    reject_if_missing: ['id', 'title', 'source']
  },
  sensitivity: {
    default: 'internal',
    reject: ['secret'],
    require_review: ['confidential', 'personal']
  },
  duplicate: {},
  quality: { min_review_score: 60, min_canonical_score: 80, weights: {} },
  routing: {},
  retention: {},
  promotion: {},
  purge: {}
};

const base: GovernanceObject = {
  metadata: {
    id: 'kb-1',
    type: 'knowledge',
    title: 'Use SQLite for local metadata',
    status: 'auto',
    source: '06-sources/reports/example.md',
    origin: 'agent',
    confidence: 'high',
    sensitivity: 'internal',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    tags: ['storage']
  },
  body:
    'Decision: use SQLite for local metadata because the system needs transactional updates and simple local deployment.',
  provenance: {
    origin: 'agent',
    agent_id: 'codex',
    reviewed_by: 'none'
  }
};

test('accepts useful governed knowledge for review', () => {
  const result = evaluateIntake(base, policy);
  assert.equal(result.decision, 'review');
  assert.ok(result.score >= 60);
});

test('rejects secret-bearing content', () => {
  const result = evaluateIntake(
    {
      ...base,
      body: `${base.body}\nAPI_KEY = 'abcdefghijklmnopqrstuvwxyz123456'`
    },
    policy
  );
  assert.equal(result.decision, 'reject');
  assert.ok(result.violations.some((x) => x.includes('secret')));
});
