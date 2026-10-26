import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplicateGroups, extractScope, filterCards, governanceStats, hasJudgment, normalizeFolderPath, promotionBlockers, queueForCard, withRoot } from './domain.js';
import { DEFAULT_SETTINGS } from './types.js';

const settings = DEFAULT_SETTINGS;

function card(path: string, title: string, status = 'auto'): any {
  return {
    path, title, status, score: 90, confidence: 'high', source: '', updated: '2026-01-01',
    // 准入三道门所要求的字段：Owner 与适用范围。
    owner: 'ken', scope: '适用于插件接入配置', state: 'active'
  };
}

test('routes governed cards by folder and status', () => {
  assert.equal(queueForCard(card(`${withRoot(settings.knowledgeRoot, settings.autoFolder)}/a.md`, 'A'), settings), 'auto');
  assert.equal(queueForCard(card(`${withRoot(settings.knowledgeRoot, settings.reviewedFolder)}/a.md`, 'A', 'review'), settings), 'review');
  assert.equal(queueForCard(card(`${withRoot(settings.knowledgeRoot, settings.canonicalFolder)}/a.md`, 'A', 'canonical'), settings), 'canonical');
  assert.equal(queueForCard(card('90-archive/governance/a.md', 'A', 'archive'), settings), 'archive');
});

test('filters by query and score', () => {
  const cards = [
    { ...card('03-knowledge/auto/a.md', 'SQLite metadata'), score: 90 },
    { ...card('03-knowledge/auto/b.md', 'Design tokens'), score: 50 }
  ];
  assert.equal(filterCards(cards, { query: 'sqlite' }).length, 1);
  assert.equal(filterCards(cards, { minScore: 80 }).length, 1);
});

test('groups exact duplicates', () => {
  const groups = duplicateGroups([
    card('a.md', 'Same Title'),
    card('b.md', 'Same Title')
  ]);
  assert.equal(groups.length, 1);
});

test('calculates queue stats', () => {
  const cards = [
    card(`${withRoot(settings.knowledgeRoot, settings.autoFolder)}/a.md`, 'A'),
    card(`${withRoot(settings.knowledgeRoot, settings.canonicalFolder)}/b.md`, 'B', 'canonical')
  ];
  const stats = governanceStats(cards, settings);
  assert.equal(stats.auto, 1);
  assert.equal(stats.canonical, 1);
});

test('rejects unsafe and ambiguous folder paths', () => {
  assert.throws(() => normalizeFolderPath('../outside'));
  assert.throws(() => normalizeFolderPath('knowledge/./auto'));
  assert.throws(() => normalizeFolderPath('C:\\outside'));
  assert.equal(normalizeFolderPath('/03-knowledge/auto/'), '03-knowledge/auto');
});

test('enforces promotion policy before mutation', () => {
  assert.deepEqual(promotionBlockers(card('a.md', 'A', 'review')), []);
  assert.ok(promotionBlockers(card('a.md', 'A', 'auto')).some(reason => reason.includes('status')));
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), score: 79 }).some(reason => reason.includes('80')));
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), confidence: 'low' }).some(reason => reason.includes('confidence')));
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), sensitivity: 'secret' }).some(reason => reason.includes('secret')));
});

test('admission gates veto cards without owner, scope, or a live validity window', () => {
  // 第一道门：来源与 Owner（一票否决）
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), owner: '' }).some(reason => reason.includes('owner')));
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), scope: '' }).some(reason => reason.includes('scope')));
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), expires_at: '2020-01-01' }).some(reason => reason.includes('expired')));
  assert.ok(!promotionBlockers({ ...card('a.md', 'A', 'review'), expires_at: '2999-01-01' }).some(reason => reason.includes('expired')));
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), state: 'retired' }).some(reason => reason.includes('state')));
  // 第二道门：复用与去重
  assert.ok(promotionBlockers({ ...card('a.md', 'A', 'review'), duplicateOf: 'other.md' }).some(reason => reason.includes('duplicate')));
});

test('judgement detection separates knowledge from raw records', () => {
  assert.equal(hasJudgment('每个 Agent 必须使用自己的令牌，否则身份会串。'), true);
  assert.equal(hasJudgment('## 核心观点\n\n配置文件的路径是 /Users/ken/.codex/config.toml。'), false);
  assert.match(extractScope('## 适用范围\n\n仅适用于 0.6.0 之后。\n\n## 关键内容\n\n必须绑定令牌。'), /0\.6\.0/);
});
