import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontmatter, stringifyFrontmatter, withFrontmatter } from './frontmatter.js';

test('parses frontmatter scalars and lists', () => {
  const input = `---
id: kb-123
title: "Complex: title"
confidence: high
count: 3
enabled: true
tags:
  - ai
  - governance
---

# Body
`;
  const parsed = parseFrontmatter(input);
  assert.equal(parsed.hasFrontmatter, true);
  assert.equal(parsed.data.id, 'kb-123');
  assert.equal(parsed.data.title, 'Complex: title');
  assert.equal(parsed.data.count, 3);
  assert.deepEqual(parsed.data.tags, ['ai', 'governance']);
  assert.equal(parsed.body.trim(), '# Body');
});

test('round-trips frontmatter', () => {
  const output = withFrontmatter(
    {
      id: 'kb-123',
      title: 'Quoted: title',
      tags: ['one', 'two'],
      confidence: 'high'
    },
    '# Body'
  );
  const parsed = parseFrontmatter(output);
  assert.equal(parsed.data.id, 'kb-123');
  assert.equal(parsed.data.title, 'Quoted: title');
  assert.deepEqual(parsed.data.tags, ['one', 'two']);
  assert.equal(parsed.data.confidence, 'high');
});
