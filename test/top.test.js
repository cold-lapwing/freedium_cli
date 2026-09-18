'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { filterTopItems, topCategoryLabel } = require('../src/top.js');

const items = [
  { title: 'Old story', excerpt: '', creator: 'A', collection: null, readingTime: 2, publishedAt: '2020-01-01T00:00:00.000Z' },
  { title: 'AI is here', excerpt: '', creator: 'B', collection: null, readingTime: 12, publishedAt: '2026-09-17T00:00:00.000Z' },
  { title: 'Against the odds', excerpt: '', creator: 'C', collection: null, readingTime: 9, publishedAt: '2026-09-18T00:00:00.000Z' },
];

test('latest sorts newest first', () => {
  const out = filterTopItems(items, 'latest');
  assert.deepEqual(out.map((i) => i.title), ['Against the odds', 'AI is here', 'Old story']);
});

test('trending preserves the front-page order', () => {
  const out = filterTopItems(items, 'trending');
  assert.deepEqual(out.map((i) => i.title), items.map((i) => i.title));
});

test('long keeps 7+ minute reads, longest first', () => {
  const out = filterTopItems(items, 'long');
  assert.deepEqual(out.map((i) => i.title), ['AI is here', 'Against the odds']);
});

test('week only keeps the last seven days', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const dated = [
    { title: 'Month old', publishedAt: new Date(now - 30 * day).toISOString() },
    { title: 'Two days old', publishedAt: new Date(now - 2 * day).toISOString() },
    { title: 'Today', publishedAt: new Date(now).toISOString() },
  ];
  const out = filterTopItems(dated, 'week');
  assert.deepEqual(out.map((i) => i.title), ['Two days old', 'Today']);
});

test('keyword matches whole words, not substrings', () => {
  const out = filterTopItems(items, 'ai');
  assert.deepEqual(out.map((i) => i.title), ['AI is here']);
});

test('multiple keywords all have to match', () => {
  assert.equal(filterTopItems(items, 'ai here').length, 1);
  assert.equal(filterTopItems(items, 'ai missing').length, 0);
});

test('category aliases resolve to friendly labels', () => {
  assert.equal(topCategoryLabel('this-week'), 'this week');
  assert.equal(topCategoryLabel('long-reads'), 'long reads');
  assert.equal(topCategoryLabel(null), 'latest');
});
