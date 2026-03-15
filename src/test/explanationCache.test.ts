import test from 'node:test';
import assert from 'node:assert/strict';

import { ExplanationCache } from '../cache/explanationCache';

test('ExplanationCache reuses summary entries', async () => {
  const cache = new ExplanationCache(60_000);
  let calls = 0;

  const first = await cache.getOrCreate('symbol', 'summary', async () => {
    calls += 1;
    return {
      key: 'symbol',
      summary: ['first summary'],
      createdAt: 1,
      sourceVersion: 2
    };
  }, 2);

  const second = await cache.getOrCreate('symbol', 'summary', async () => {
    calls += 1;
    return {
      key: 'symbol',
      summary: ['second summary'],
      createdAt: 2,
      sourceVersion: 2
    };
  }, 2);

  assert.equal(calls, 1);
  assert.equal(first.summary[0], 'first summary');
  assert.equal(second.summary[0], 'first summary');
});

test('ExplanationCache merges detail into existing summary entry', () => {
  const cache = new ExplanationCache(60_000);
  cache.set({
    key: 'symbol',
    summary: ['summary'],
    createdAt: 1,
    sourceVersion: 4
  });

  const merged = cache.set({
    key: 'symbol',
    summary: [],
    detailMarkdown: '# Detail',
    createdAt: 2,
    sourceVersion: 4
  });

  assert.deepEqual(merged.summary, ['summary']);
  assert.equal(merged.detailMarkdown, '# Detail');
});
