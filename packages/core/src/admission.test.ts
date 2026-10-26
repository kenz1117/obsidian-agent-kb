import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { admissionBlockers, hasJudgment, extractScope } from './governance.ts';
import type { GovernanceMetadata, GovernancePolicy } from './types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(here, '../../../apps/gateway/config/governance.policy.json');

const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as GovernancePolicy;

const meta = (overrides: Partial<GovernanceMetadata> = {}): GovernanceMetadata => ({
  id: 'kb-1',
  type: 'knowledge',
  title: '示例',
  status: 'review',
  source: 'agent://codex',
  origin: 'agent',
  confidence: 'high',
  sensitivity: 'internal',
  owner: 'ken',
  scope: '适用于插件接入配置',
  created: '2026-01-01',
  updated: '2026-01-01',
  tags: [],
  ...overrides
});

const judgmentBody = '## 关键内容\n\n每个 Agent 必须使用自己的令牌，否则身份会串。';

test('policy file declares the admission gates', () => {
  assert.ok(policy.admission, 'admission block missing from policy');
  assert.equal(typeof policy.admission.require_owner, 'boolean');
  assert.equal(typeof policy.admission.require_scope, 'boolean');
  assert.equal(typeof policy.admission.require_judgment, 'boolean');
});

test('a complete card passes every gate', () => {
  assert.deepEqual(admissionBlockers({ metadata: meta(), body: judgmentBody }, policy), []);
});

test('missing owner is a veto', () => {
  const blockers = admissionBlockers({ metadata: meta({ owner: undefined }), body: judgmentBody }, policy);
  assert.ok(blockers.includes('missing owner'));
});

test('missing scope is a veto', () => {
  const blockers = admissionBlockers({ metadata: meta({ scope: undefined }), body: judgmentBody }, policy);
  assert.ok(blockers.includes('missing scope'));
});

test('an expired card is a veto', () => {
  const blockers = admissionBlockers({ metadata: meta({ expires_at: '2020-01-01' }), body: judgmentBody }, policy);
  assert.ok(blockers.some(b => b.includes('expired')));
});

test('a future expiry is allowed', () => {
  const blockers = admissionBlockers({ metadata: meta({ expires_at: '2999-01-01' }), body: judgmentBody }, policy);
  assert.ok(!blockers.some(b => b.includes('expired')));
});

test('a duplicate is a veto', () => {
  const metadata = meta();
  (metadata as unknown as Record<string, unknown>).duplicate_of = '03-knowledge/canonical/other.md';
  const blockers = admissionBlockers({ metadata, body: judgmentBody }, policy);
  assert.ok(blockers.some(b => b.includes('duplicate')));
});

test('a retired card is a veto', () => {
  const blockers = admissionBlockers({ metadata: meta({ state: 'retired' }), body: judgmentBody }, policy);
  assert.ok(blockers.some(b => b.includes('state is')));
});

test('information-only content is not knowledge', () => {
  const body = '## 核心观点\n\n配置文件的路径是 /Users/ken/.codex/config.toml。';
  const blockers = admissionBlockers({ metadata: meta(), body }, policy);
  assert.ok(blockers.includes('content contains no reusable judgment'));
});

test('judgment detection covers Chinese', () => {
  assert.equal(hasJudgment(judgmentBody), true);
  assert.equal(hasJudgment('## 核心观点\n\n今天的天气很好。'), false);
});

test('judgment detection covers English', () => {
  assert.equal(hasJudgment('Each agent must use its own token.'), true);
});

test('scope can be extracted from the 适用范围 section', () => {
  const body = '## 适用范围\n\n仅适用于插件 0.6.0 及之后的版本。\n\n## 关键内容\n\n必须绑定令牌。';
  assert.match(extractScope(body), /0\.6\.0/);
  const metadata = meta({ scope: undefined });
  const blockers = admissionBlockers({ metadata, body }, policy);
  assert.ok(!blockers.includes('missing scope'));
});

/**
 * 跨语言漂移护栏：TypeScript 与 Python 两套判断力检测实现共用同一份用例，
 * 任何一边改动导致判定不一致都会在这里暴露。
 */
const judgmentCases = (JSON.parse(
  readFileSync(path.join(here, 'fixtures/judgment-cases.json'), 'utf8')
) as { cases: Array<{ id: string; body: string; judgment: boolean }> }).cases;

for (const item of judgmentCases) {
  test(`judgment case: ${item.id}`, () => {
    assert.equal(hasJudgment(item.body), item.judgment);
  });
}
