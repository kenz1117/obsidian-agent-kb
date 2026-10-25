import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplicateGroups, filterCards, governanceStats, queueForCard, withRoot } from './domain.js';
import { DEFAULT_SETTINGS } from './types.js';

const settings = DEFAULT_SETTINGS;

function card(path: string, title: string, status = 'auto'): any {
  return { path, title, status, score: 90, confidence: 'high', source: '', updated: '2026-01-01' };
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
