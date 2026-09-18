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

async function fetchArticle(url, host) {
  const target = normalizeUrl(url);

  if (/^https?:\/\//i.test(host)) {
    host = new URL(host).hostname;
  }

  const freediumUrl = `https://${host}/${target.replace(/^https?:\/\//i, '')}`;

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
    throw new Error(
      `could not reach ${host} (${err.cause?.code || err.message}). ` +
        `Try a different mirror with --host or the FREEDIUM_HOST env var.`
    );
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`unable to read that URL — the article could not be resolved (404)`);
    }
    if (res.status === 429 || res.status === 403) {
      throw new Error(`rate-limited by ${host} (${res.status}). Try again later.`);
    }
    throw new Error(`freedium returned HTTP ${res.status}`);
  }

  return res.text();
}

function unescapeJs(str) {
  if (!str) return '';
  return str.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, esc) => {
    if (esc[0] === 'u' || esc[0] === 'x') return String.fromCodePoint(parseInt(esc.slice(1), 16));
    const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
    return map[esc] !== undefined ? map[esc] : esc;
  });
}

// Pull `{slug:"...", title:"...", ...}` objects out of the SvelteKit hydration
// payload. The objects are JS literals, not JSON, so walk them quote-aware to
// find each balanced block instead of trusting field order.
function extractDataBlocks(seg) {
  const blocks = [];
  for (let i = 0; i < seg.length; i++) {
    if (seg[i] !== '{' || !/^\{\s*slug:"/.test(seg.slice(i, i + 10))) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < seg.length; j++) {
      const c = seg[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    blocks.push(seg.slice(i, j));
    i = j - 1;
  }
  return blocks;
}

const FEED_FIELDS = {
  slug: /\bslug:"((?:[^"\\]|\\.)*)"/,
  title: /\btitle:"((?:[^"\\]|\\.)*)"/,
  excerpt: /\bexcerpt:"((?:[^"\\]|\\.)*)"/,
  image: /\bimageUrl:"((?:[^"\\]|\\.)*)"/,
  readingTime: /\breadingTime:"([^"]*)"/,
  publishedAt: /\bpublishedAt:"([^"]*)"/,
  creator: /\bcreator:"((?:[^"\\]|\\.)*)"/,
  collection: /\bcollection:(null|\{[\s\S]*?\})/,
};

function parseFeedItem(block) {
  const get = (k) => {
    const m = block.match(FEED_FIELDS[k]);
    return m ? m[1] : undefined;
  };
  const colRaw = get('collection');
  const colName =
    colRaw && colRaw !== 'null' ? (colRaw.match(/\bname:"((?:[^"\\]|\\.)*)"/) || [])[1] : undefined;

  const id = unescapeJs(get('slug') || '');
  const title = unescapeJs(get('title') || '');
  if (!id || !title) return null;

  return {
    id,
    title,
    excerpt: unescapeJs(get('excerpt') || ''),
    image: get('image') || '',
    readingTime: Number(get('readingTime')) || 0,
    publishedAt: get('publishedAt') || '',
    creator: unescapeJs(get('creator') || ''),
    collection: colName ? unescapeJs(colName) : null,
  };
}

async function fetchTopArticles(host, options = {}) {
  if (/^https?:\/\//i.test(host)) {
    host = new URL(host).hostname;
  }

  let res;
  try {
    res = await fetch(`https://${host}/`, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (err) {
    throw new Error(
      `could not reach ${host} (${err.cause?.code || err.message}). ` +
        `Try a different mirror with --host or the FREEDIUM_HOST env var.`
    );
  }

  if (!res.ok) {
    throw new Error(`could not fetch the feed from ${host} (HTTP ${res.status})`);
  }

  const html = await res.text();
  const idx = html.indexOf('resolve(');
  const seg = idx === -1 ? html : html.slice(idx);
  const items = extractDataBlocks(seg)
    .map(parseFeedItem)
    .filter(Boolean)
    .map((item) => ({
      ...item,
      // The front page only exposes the article hash; freedium resolves the
      // full article (and redirects) from it.
      link: `https://medium.com/${item.id}`,
    }));

  return options.limit ? items.slice(0, options.limit) : items;
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

module.exports = { fetchArticle, fetchTopArticles, extractArticle, downloadArticle, normalizeUrl };