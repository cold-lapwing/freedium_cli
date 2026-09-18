'use strict';

const fs = require('node:fs');
const path = require('node:path');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function normalizeUrl(url) {
  let u = String(url).trim();
  if (!u) throw new Error('empty URL');

  if (!/^https?:\/\//i.test(u)) {
    u = 'https://' + u;
  }

  const parsed = new URL(u);
  if (!parsed.hostname) throw new Error(`invalid URL: ${url}`);

  return parsed.toString();
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpMessage(status, host) {
  if (status === 404) {
    return 'unable to read that URL — the article could not be resolved (404)';
  }
  if (status === 429 || status === 403) {
    return `rate-limited by ${host} (${status}). Try again later.`;
  }
  if (status === 503 || status === 502 || status === 504) {
    return (
      `${host} is temporarily unavailable (${status}). The freedium mirror ` +
      `looks down — try again shortly, or use --host / FREEDIUM_HOSTS with another mirror.`
    );
  }
  return `freedium returned HTTP ${status}`;
}

// Build the freedium URL, retrying transient failures (5xx / network) before
// giving up on this host.
async function fetchFromHost(target, host, attempts) {
  const hostname = /^https?:\/\//i.test(host) ? new URL(host).hostname : host;
  const freediumUrl = `https://${hostname}/${target.replace(/^https?:\/\//i, '')}`;

  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    try {
      res = await fetch(freediumUrl, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
    } catch (err) {
      if (attempt < attempts) {
        await sleep(300 * attempt);
        continue;
      }
      const e = new Error(
        `could not reach ${hostname} (${err.cause?.code || err.message}). ` +
          `Try a different mirror with --host or the FREEDIUM_HOSTS env var.`
      );
      e.retryable = true;
      throw e;
    }

    if (res.ok) return res.text();

    lastStatus = res.status;
    if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) {
      await sleep(400 * attempt);
      continue;
    }

    const e = new Error(httpMessage(res.status, hostname));
    e.status = res.status;
    e.retryable = RETRYABLE_STATUS.has(res.status);
    throw e;
  }

  const e = new Error(httpMessage(lastStatus, hostname));
  e.status = lastStatus;
  e.retryable = true;
  throw e;
}

async function fetchArticle(url, host, options = {}) {
  const target = normalizeUrl(url);
  const hosts = (Array.isArray(host) ? host : [host]).filter(Boolean);
  const attempts = Math.max(1, options.attempts || 2);

  let lastErr;
  for (let i = 0; i < hosts.length; i++) {
    try {
      return await fetchFromHost(target, hosts[i], attempts);
    } catch (err) {
      lastErr = err;
      // Only hop to the next mirror for transient problems; a 404 is final.
      if (err.retryable && i < hosts.length - 1) continue;
      throw err;
    }
  }

  throw lastErr || new Error('no freedium host available');
}

const MEDIUM_GRAPHQL = 'https://medium.com/_/graphql';

// Medium's own topic feed (`Query.tagFeed`), the same data the topic page
// renders in `__APOLLO_STATE__` — but as one call that also returns reading
// time, clap counts and tags. `paging.limit` is capped at 25 by the API.
const TOPIC_FEED_QUERY = `query TopicFeed($tagSlug: String!) {
  tagFeed(tagSlug: $tagSlug, mode: %MODE%, paging: {limit: %LIMIT%}) {
    items {
      post {
        id
        title
        uniqueSlug
        mediumUrl
        readingTime
        firstPublishedAt
        latestPublishedAt
        clapCount
        isLocked
        creator { name username }
        collection { name }
        previewImage { id alt }
        tags { displayTitle }
      }
    }
  }
}`;

const TOPIC_MODES = new Set(['TOP_WEEK', 'TOP_MONTH', 'TOP_YEAR', 'TOP_ALL_TIME', 'NEW']);

async function mediumGraphQL(operationName, query, variables) {
  let res;
  try {
    res = await fetch(MEDIUM_GRAPHQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'User-Agent': UA,
        'apollo-require-preflight': 'true',
        'x-apollo-operation-name': operationName,
      },
      body: JSON.stringify({ operationName, query, variables }),
    });
  } catch (err) {
    throw new Error(`could not reach medium.com (${err.cause?.code || err.message})`);
  }

  if (!res.ok) throw new Error(`medium.com returned HTTP ${res.status}`);

  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

// Normalize a Medium GraphQL `Post` into the shape the picker/filters use.
function normalizePost(post) {
  if (!post || !post.title) return null;
  const link = post.mediumUrl || (post.uniqueSlug ? `https://medium.com/${post.uniqueSlug}` : '');
  if (!link) return null;

  const ts = post.firstPublishedAt || post.latestPublishedAt || 0;
  return {
    id: post.id || post.uniqueSlug || link,
    title: post.title,
    link,
    creator: (post.creator && (post.creator.name || post.creator.username)) || '',
    collection: (post.collection && post.collection.name) || '',
    readingTime: post.readingTime ? Math.max(1, Math.round(post.readingTime)) : 0,
    publishedAt: ts ? new Date(ts).toISOString() : '',
    claps: post.clapCount || 0,
    locked: Boolean(post.isLocked),
    topics: (post.tags || []).map((t) => t.displayTitle).filter(Boolean),
  };
}

async function fetchTopicFeed(topic, options = {}) {
  const mode = TOPIC_MODES.has(options.mode) ? options.mode : 'TOP_WEEK';
  const limit = Math.min(Math.max(1, Number(options.limit) || 25), 25);
  const query = TOPIC_FEED_QUERY.replace('%MODE%', mode).replace('%LIMIT%', String(limit));
  const data = await mediumGraphQL('TopicFeed', query, { tagSlug: topic });
  const items = (data && data.tagFeed && data.tagFeed.items) || [];
  return items.map((it) => normalizePost(it.post)).filter(Boolean);
}

function cdata(tag, xml) {
  const m = xml.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
  );
  return m ? m[1] : '';
}

// Fallback when GraphQL is unavailable: Medium's per-tag RSS (10 items).
function parseRssItems(xml) {
  return String(xml)
    .split(/<item>/)
    .slice(1)
    .map((chunk) => {
      const item = chunk.split('</item>')[0];
      const title = decodeEntities(cdata('title', item).trim());
      const link = decodeEntities(cdata('link', item).trim()).split('?')[0];
      if (!title || !link) return null;
      const pub = cdata('pubDate', item).trim();
      return {
        id: link,
        title,
        link,
        creator: decodeEntities(cdata('dc:creator', item).trim()),
        collection: '',
        readingTime: 0,
        publishedAt: pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : '',
        claps: 0,
        locked: false,
        topics: [],
      };
    })
    .filter(Boolean);
}

async function fetchTopicRss(topic) {
  let res;
  try {
    res = await fetch(`https://medium.com/feed/tag/${encodeURIComponent(topic)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' },
      redirect: 'follow',
    });
  } catch (err) {
    throw new Error(`could not reach medium.com (${err.cause?.code || err.message})`);
  }
  if (!res.ok) throw new Error(`medium.com returned HTTP ${res.status}`);
  return parseRssItems(await res.text());
}

async function fetchMediumTopic(topic, options = {}) {
  try {
    const items = await fetchTopicFeed(topic, options);
    if (items.length) return items;
  } catch (err) {
    // Fall through to RSS.
  }
  return fetchTopicRss(topic);
}

// Fetch several topics in parallel and merge them, de-duplicated by URL.
async function fetchTopicFeeds(topics, mode) {
  const results = await Promise.all(
    topics.map(async (topic) => {
      try {
        return { items: await fetchMediumTopic(topic, { mode, limit: 25 }) };
      } catch (err) {
        return { error: err };
      }
    })
  );

  const seen = new Set();
  const merged = [];
  for (const result of results) {
    for (const item of result.items || []) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      merged.push(item);
    }
  }

  // If nothing came back and every topic errored, surface the real cause
  // (network/rate-limit) instead of a misleading "no articles found".
  if (!merged.length && results.every((r) => r.error)) {
    throw results[0].error;
  }
  return merged;
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function extractArticle(html) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : 'Untitled';

  const descriptionMatch = html.match(
    /<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i
  );
  const description = descriptionMatch ? decodeEntities(descriptionMatch[1].trim()) : '';

  const proseMatch = html.match(/<div[^>]*class=["'][^"']*\bprose\b[^"']*["'][^>]*>/i);
  let content = '';
  if (proseMatch) {
    const start = proseMatch.index + proseMatch[0].length;
    let depth = 1;
    let i = start;
    const DIV_OPEN = /<div\b[^>]*>/gi;
    const DIV_CLOSE = /<\/div\s*>/gi;
    while (i < html.length && depth > 0) {
      DIV_OPEN.lastIndex = i;
      DIV_CLOSE.lastIndex = i;
      const po = DIV_OPEN.exec(html);
      const pc = DIV_CLOSE.exec(html);
      if (!po || (pc && pc.index < po.index)) {
        if (pc) {
          depth--;
          content += html.slice(i, pc.index) + pc[0];
          i = pc.index + pc[0].length;
        } else {
          content += html.slice(i);
          break;
        }
      } else {
        if (po) {
          depth++;
          content += html.slice(i, po.index) + po[0];
          i = po.index + po[0].length;
        } else {
          content += html.slice(i);
          break;
        }
      }
    }
  }

  let author = '';
  let date = '';
  let readingTime = '';

  const authorMatch = html.match(/>By\s+([^<]+)</i);
  if (authorMatch) author = authorMatch[1].trim();

  const dateMatch = html.match(/<header[^>]*>\s*<p[^>]*>([^<]+)<\/p>/i);
  if (dateMatch) date = dateMatch[1].trim();

  const rtMatch = html.match(/>(\d+)\s*min read</i);
  if (rtMatch) readingTime = rtMatch[1] + ' min read';

  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  if (ogTitleMatch && title === 'Untitled') {
    title = decodeEntities(ogTitleMatch[1]);
  }

  const isErrorPage =
    /<title[^>]*>[^<]*?\bFreedium\b\s*[-–]\s*\bFreedium\b[^<]*<\/title>/i.test(html) ||
    /404\s*[-–]\s*article not found/i.test(html);

  return {
    title,
    description,
    subtitle: description,
    author,
    date,
    readingTime,
    content,
    ok: !isErrorPage,
    error: isErrorPage ? 'this URL does not point to a readable Medium article' : null,
  };
}

function downloadArticle(article, opts) {
  const target = opts.output;
  const outPath = target.endsWith('.md')
    ? target
    : path.join(target, slugify(article.title) + '.md');

  const frontmatter = [
    '---',
    `title: "${article.title.replace(/"/g, '\\"')}"`,
    article.author ? `author: "${article.author}"` : null,
    article.date ? `date: ${article.date}` : null,
    article.readingTime ? `reading_time: "${article.readingTime}"` : null,
    `source: ${opts.url || ''}`,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  const md = frontmatter + '\n\n# ' + article.title + '\n\n' + article.markdown + '\n';

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  process.stderr.write(`✎ saved to ${outPath}\n`);
  return outPath;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'article';
}

async function searchMediumQuery(query, options = {}) {
  // Medium's SSR-rendered search is fetched through the GraphQL endpoint
  // (medium.com/_/graphql) using the SearchQuery operation. This is the same
  // query the web app uses to populate /search results. We request Posts only
  // (withUsers/withTags/etc are all false) to keep the payload small.
  const op = `
    query SearchQuery($query: String!, $pagingOptions: SearchPagingOptions!, $withPosts: Boolean!, $postsSearchOptions: SearchOptions) {
      search(query: $query) {
        __typename
        ... on Search {
          posts(pagingOptions: $pagingOptions, algoliaOptions: $postsSearchOptions) @include(if: $withPosts) {
            ... on SearchPost {
              items {
                id
                title
                uniqueSlug
                mediumUrl
                readingTime
                firstPublishedAt
                clapCount
                isLocked
                creator { name username }
                collection { name }
              }
              pagingInfo {
                next { limit page }
              }
            }
          }
        }
      }
    }
  `.trim();

  const variables = {
    query: String(query || '').trim(),
    pagingOptions: { limit: options.limit || 25, page: 0 },
    withPosts: true,
    postsSearchOptions: null,
  };

  const hostname = 'medium.com';
  const body = JSON.stringify({ operationName: 'SearchQuery', query: op, variables });

  const res = await fetch(`https://${hostname}/_/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'User-Agent': UA,
      'Accept': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`medium.com search returned HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`medium.com returned invalid JSON (${err.message})`);
  }

  if (data.errors && data.errors.length) {
    // GraphQLError messages are usually informative enough to surface.
    const msg = data.errors.map((e) => e.message).join('; ');
    throw new Error(`medium.com search failed: ${msg}`);
  }

  const search = data.data && data.data.search;
  if (!search || search.__typename !== 'Search') {
    return []; // empty / no results
  }

  const posts = search.posts && search.posts.items ? search.posts.items : [];
  return posts.map(normalizeSearchPost);
}

function normalizeSearchPost(item) {
  if (!item) return null;

  // Older / alternate response shapes may wrap the post in item.post when
  // item.__typename === 'SearchPostResult'. Unwrap in that case.
  if (item.__typename === 'SearchPostResult' && item.post) {
    item = item.post;
  }

  const title = item.title || '';
  const mediumUrl = item.mediumUrl || '';

  // If after unwrapping we still have no useful data, bail out.
  if (!title && !mediumUrl) return null;

  const creator = item.creator
    ? item.creator.name || item.creator.username || ''
    : '';
  const readingTime = item.readingTime != null ? item.readingTime : 0;
  const publishedAt = item.firstPublishedAt
    ? new Date(item.firstPublishedAt).toISOString()
    : '';
  const claps = item.clapCount != null ? item.clapCount : 0;
  const locked = !!item.isLocked;

  // topics
  const topics = (item.topics || [])
    .map((t) => t.displayTitle || '')
    .filter(Boolean);
  if (item.collection && item.collection.name) {
    topics.unshift(item.collection.name);
  }

  const uniqueSlug = item.uniqueSlug || '';

  return {
    id: item.id || mediumUrl || uniqueSlug || '',
    title,
    link: mediumUrl,
    creator,
    readingTime,
    publishedAt,
    claps,
    locked,
    topics,
    uniqueSlug,
  };
}

module.exports = {
  fetchArticle,
  fetchTopicFeed,
  fetchTopicRss,
  fetchMediumTopic,
  fetchTopicFeeds,
  parseRssItems,
  normalizePost,
  extractArticle,
  downloadArticle,
  normalizeUrl,
  searchMediumQuery,
  normalizeSearchPost,
};