'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planTopQuery, applyTopPlan, slugifyTopic, DEFAULT_TOPICS } = require('../src/top.js');

test('latest sorts newest first and fetches the default topics with mode NEW', () => {
  const plan = planTopQuery('latest');
  assert.equal(plan.mode, 'NEW');
  assert.deepEqual(plan.topics, DEFAULT_TOPICS);
  const items = [
    { title: 'old', publishedAt: '2020-01-01T00:00:00.000Z' },
    { title: 'new', publishedAt: '2026-09-18T00:00:00.000Z' },
  ];
  assert.deepEqual(applyTopPlan(items, plan).map((i) => i.title), ['new', 'old']);
});

test('trending orders by claps', () => {
  const plan = planTopQuery('trending');
  assert.equal(plan.mode, 'TOP_WEEK');
  const items = [
    { title: 'few', claps: 10 },
    { title: 'lots', claps: 5000 },
  ];
  assert.deepEqual(applyTopPlan(items, plan).map((i) => i.title), ['lots', 'few']);
});

test('long keeps 7+ minute reads, longest first', () => {
  const plan = planTopQuery('long');
  assert.equal(plan.mode, 'TOP_MONTH');
  const items = [
    { title: 'short', readingTime: 3 },
    { title: 'medium', readingTime: 9 },
    { title: 'long', readingTime: 20 },
  ];
  assert.deepEqual(applyTopPlan(items, plan).map((i) => i.title), ['long', 'medium']);
});

test('week drops articles older than seven days', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const items = [
    { title: 'Month old', publishedAt: new Date(now - 30 * day).toISOString() },
    { title: 'Two days old', publishedAt: new Date(now - 2 * day).toISOString() },
    { title: 'Today', publishedAt: new Date(now).toISOString() },
  ];
  assert.deepEqual(applyTopPlan(items, planTopQuery('week')).map((i) => i.title), [
    'Two days old',
    'Today',
  ]);
});

test('all uses the all-time feed', () => {
  assert.equal(planTopQuery('all').mode, 'TOP_ALL_TIME');
});

test('an unknown word becomes a single topic slug', () => {
  const plan = planTopQuery('machine learning');
  assert.deepEqual(plan.topics, ['machine-learning']);
  assert.equal(plan.label, 'machine learning');
});

test('topic slugs strip punctuation', () => {
  assert.equal(slugifyTopic('Artificial Intelligence!'), 'artificial-intelligence');
  assert.equal(slugifyTopic('  C++  '), 'c');
});
