'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRssItems, normalizePost, normalizeSearchPost } = require('../src/fetch.js');

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <item>
    <title><![CDATA[Hello & <World>]]></title>
    <link>https://medium.com/@who/hello-world-abc123?source=rss----1---2</link>
    <dc:creator>Jane Doe</dc:creator>
    <pubDate>Fri, 18 Sep 2026 07:01:04 GMT</pubDate>
  </item>
  <item>
    <title>Second Post</title>
    <link>https://medium.com/topic/second-post-def456</link>
    <dc:creator>John</dc:creator>
    <pubDate>Thu, 17 Sep 2026 07:01:04 GMT</pubDate>
  </item>
</channel>
</rss>`;

test('parseRssItems extracts title, link, author and date', () => {
  const items = parseRssItems(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Hello & <World>');
  assert.equal(items[0].link, 'https://medium.com/@who/hello-world-abc123');
  assert.equal(items[0].creator, 'Jane Doe');
  assert.equal(items[0].publishedAt, '2026-09-18T07:01:04.000Z');
  assert.equal(items[1].title, 'Second Post');
});

test('normalizePost rounds reading time and maps fields', () => {
  const item = normalizePost({
    id: 'p1',
    title: 'A Post',
    mediumUrl: 'https://medium.com/@a/a-post-1',
    readingTime: 7.5,
    firstPublishedAt: 1788202126717,
    clapCount: 1234,
    isLocked: true,
    creator: { name: 'Ann', username: 'ann' },
    collection: { name: 'The Pub' },
    tags: [{ displayTitle: 'AI' }],
  });
  assert.equal(item.readingTime, 8);
  assert.equal(item.creator, 'Ann');
  assert.equal(item.collection, 'The Pub');
  assert.equal(item.claps, 1234);
  assert.equal(item.locked, true);
  assert.deepEqual(item.topics, ['AI']);
  assert.equal(item.link, 'https://medium.com/@a/a-post-1');
});

test('normalizePost falls back to the slug and drops empty posts', () => {
  const item = normalizePost({ title: 'No URL', uniqueSlug: 'no-url-xyz' });
  assert.equal(item.link, 'https://medium.com/no-url-xyz');
  assert.equal(normalizePost(null), null);
  assert.equal(normalizePost({ title: '' }), null);
});

// ---- searchMediumQuery ----

test('normalizeSearchPost maps Medium SearchPost items to search items', () => {
  const item = {
    id: 'p1',
    title: 'A Post',
    uniqueSlug: 'a-post-1',
    mediumUrl: 'https://medium.com/@a/a-post-1',
    readingTime: 5.2,
    firstPublishedAt: 1788202126717,
    clapCount: 42,
    isLocked: true,
    creator: { name: 'Ann', username: 'ann' },
    collection: { name: 'The Pub' },
    topics: [{ displayTitle: 'AI' }, { displayTitle: 'Rust' }],
  };
  const result = normalizeSearchPost(item);
  assert.equal(result.title, 'A Post');
  assert.equal(result.link, 'https://medium.com/@a/a-post-1');
  assert.equal(result.creator, 'Ann');
  assert.equal(result.readingTime, 5.2);
  assert.equal(result.claps, 42);
  assert.equal(result.locked, true);
  assert.deepEqual(result.topics, ['The Pub', 'AI', 'Rust']);
});

test('normalizeSearchPost handles item.post wrapper shape', () => {
  const item = {
    id: 'p2',
    title: 'Wrapper',
    __typename: 'SearchPostResult',
    post: {
      title: 'Real Title',
      mediumUrl: 'https://medium.com/real',
      creator: { username: 'u1' },
    },
  };
  assert.equal(normalizeSearchPost(item).title, 'Real Title');
  assert.equal(normalizeSearchPost(item).link, 'https://medium.com/real');
});

test('normalizeSearchPost returns null for null item', () => {
  assert.equal(normalizeSearchPost(null), null);
  assert.equal(normalizeSearchPost({}), null);
});
