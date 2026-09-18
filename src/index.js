'use strict';

const { spawn } = require('node:child_process');
const { fetchArticle, fetchTopArticles, extractArticle, downloadArticle } = require('./fetch.js');
const { htmlToMarkdown } = require('./converter.js');
const { renderMarkdown } = require('./render.js');
const { resolveMode } = require('./images.js');
const { pick } = require('./picker.js');
const { filterTopItems, topCategoryLabel, topItemLabel } = require('./top.js');

const VERSION = require('../package.json').version;

const IMAGE_MODES = ['auto', 'ansi', 'sixel', 'kitty', 'text'];

function normalizeImageMode(value) {
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'auto'].includes(v)) return 'auto';
  if (['false', '0', 'no', 'off', 'text', 'none'].includes(v)) return 'text';
  return IMAGE_MODES.includes(v) ? v : null;
}

function resolvePager() {
  const raw = (process.env.FREEDIUM_PAGER || process.env.PAGER || 'less').trim();
  if (!raw || /^(cat|none)$/i.test(raw)) return null;
  const parts = raw.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  if (cmd === 'less' && !args.some((a) => /^-[a-zA-Z]*[Rr]/.test(a))) args.unshift('-R');
  return { cmd, args };
}

function pageThrough(text, pager) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(pager.cmd, pager.args, { stdio: ['pipe', 'inherit', 'inherit'] });
    } catch {
      process.stdout.write(text);
      return resolve();
    }
    let failed = false;
    child.on('error', () => {
      failed = true;
      process.stdout.write(text);
      resolve();
    });
    child.on('close', () => {
      if (!failed) resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}

// Print rendered output, paging it when it is taller than the terminal so the
// reader starts at the top. Raw image protocols (sixel/kitty) bypass the pager.
async function emitArticle(text, opts) {
  const imgCfg = resolveMode(opts.image, { useColor: opts.color, isTTY: process.stdout.isTTY });
  const rawImages = imgCfg.mode === 'sixel' || imgCfg.mode === 'kitty';
  const lines = text.replace(/\n$/, '').split('\n').length;
  const rows = process.stdout.rows || 24;
  const usePager =
    opts.pager !== false &&
    !opts.markdown &&
    !opts.output &&
    process.stdout.isTTY &&
    !rawImages &&
    lines > rows - 1;

  if (usePager) {
    const pager = resolvePager();
    if (pager) return pageThrough(text, pager);
  }
  process.stdout.write(text);
}

const HELP = `freedium — Read Medium articles without the paywall, in your terminal

usage:
  freedium <url>             read a Medium article
  freedium top               browse the front page and pick one (↑/↓ + enter)
  freedium top <category>    browse a category (see categories below)
  freedium top <category> 3  open the 3rd article in that category
  freedium <url> -m          dump raw markdown (great for piping)
  freedium <url> -o file     write markdown to a file
  freedium -h                show this help
  freedium -v                show version

categories:
  latest (default), trending, week, long, all
  ...or any keyword, e.g. "ai", "security", "python", "startup"

options:
  -h, --help       show this help message
  -v, --version    show the version
  -m, --markdown   output raw markdown instead of colored text
  -o, --output     write output to a file instead of stdout
      --no-color   disable ANSI colors
      --no-pager   print straight through instead of opening a pager
      --host       set a custom freedium host (default: ${process.env.FREEDIUM_HOST || 'freedium-mirror.cfd'})
      --no-images  render article images as text placeholders instead
      --image-width N   image width in terminal columns (default: full width)
      --image VALUE     enable images: true | false | auto | ansi | sixel | kitty

environment:
  FREEDIUM_HOST       override the freedium mirror host
  FREEDIUM_NO_IMAGES  set to 1 to disable image rendering
  FREEDIUM_IMAGE_MODE image mode (auto|ansi|sixel|kitty|text)
  FREEDIUM_IMAGE_WIDTH image width in terminal columns
  FREEDIUM_PAGER      pager command (default: \$PAGER, else less)

examples:
  freedium https://medium.com/@user/article-hash
  freedium https://medium.com/article-hash
  freedium -m https://medium.com/@user/article-hash | pandoc -o article.html
`;

function fail(message) {
  process.stderr.write(`\x1b[31m✖\x1b[0m ${message}\n`);
  process.exit(1);
}

async function showArticle(url, opts) {
  const articleHtml = await fetchArticle(url, opts.host);
  const article = extractArticle(articleHtml);

  if (!article.ok) {
    fail(article.error || 'this URL does not point to a readable Medium article');
    return;
  }

  const markdown = htmlToMarkdown(article.content);
  const payload = { ...article, markdown, host: opts.host };

  if (opts.output) {
    return downloadArticle(payload, { ...opts, url });
  }

  if (opts.markdown) {
    process.stdout.write(payload.title + '\n\n' + markdown + '\n');
    return;
  }

  await emitArticle((await renderMarkdown(payload, opts)) + '\n', opts);
}

async function runTop(opts) {
  const all = await fetchTopArticles(opts.host);
  if (!all.length) {
    fail(`no articles found on ${opts.host}`);
    return;
  }

  const category = opts.topCategory || 'latest';
  const items = filterTopItems(all, category);
  if (!items.length) {
    fail(`no articles found for "${category}" on ${opts.host}`);
    return;
  }

  if (opts.topIndex) {
    const picked = items[opts.topIndex - 1];
    if (!picked) fail(`no article #${opts.topIndex} (${topCategoryLabel(category)} has ${items.length})`);
    return showArticle(picked.link, opts);
  }

  const nonInteractive = !process.stdin.isTTY || !process.stdout.isTTY || opts.markdown || opts.output;

  if (nonInteractive) {
    const list = items
      .map((item, i) => {
        const num = String(i + 1).padStart(2);
        const meta = [
          item.creator,
          item.readingTime ? item.readingTime + ' min' : '',
          item.publishedAt ? item.publishedAt.slice(0, 10) : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `  ${num}. ${item.title}${meta ? `\n      ${meta}` : ''}`;
      })
      .join('\n');
    process.stdout.write(`Top articles — ${topCategoryLabel(category)} (${opts.host}):\n\n${list}\n`);
    return;
  }

  const selected = await pick(items, {
    color: opts.color,
    header: `Top articles on ${opts.host} · ${topCategoryLabel(category)}`,
    hint: '↑/↓ move · enter open · q quit',
    label: topItemLabel,
  });

  if (selected == null) {
    process.stdout.write('Aborted.\n');
    return;
  }

  return showArticle(items[selected].link, opts);
}

async function run() {
  const argv = process.argv.slice(2);
  const opts = {
    markdown: false,
    color: true,
    host: process.env.FREEDIUM_HOST || 'freedium-mirror.cfd',
    output: null,
    url: null,
    command: null,
    topIndex: null,
    topCategory: null,
    image: process.env.FREEDIUM_IMAGE_MODE ? normalizeImageMode(process.env.FREEDIUM_IMAGE_MODE) || 'text' : 'text',
    imageWidth: process.env.FREEDIUM_IMAGE_WIDTH ? Number(process.env.FREEDIUM_IMAGE_WIDTH) : null,
    pager: true,
  };

  if (process.env.FREEDIUM_NO_IMAGES) opts.image = 'text';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(HELP);
        return;
      case '-v':
      case '--version':
        process.stdout.write(`${VERSION}\n`);
        return;
      case '-m':
      case '--markdown':
        opts.markdown = true;
        break;
      case '--no-color':
        opts.color = false;
        break;
      case '--no-pager':
        opts.pager = false;
        break;
      case '--no-images':
        opts.markdown = false;
        opts.image = 'text';
        break;
      case '--image-width':
        if (!argv[i + 1]) fail('--image-width requires a number');
        const iw = Number(argv[++i]);
        if (!Number.isFinite(iw) || iw < 1) fail('--image-width must be a positive number');
        opts.imageWidth = iw;
        break;
      case '--image':
        if (!argv[i + 1]) fail('--image requires a value: true, false, or a mode (auto|ansi|sixel|kitty)');
        const mode = normalizeImageMode(argv[++i]);
        if (!mode) fail('--image must be true, false, or one of: auto, ansi, sixel, kitty');
        opts.image = mode;
        break;
      case '-o':
      case '--output':
        if (!argv[i + 1]) fail('--output requires a file path');
        opts.output = argv[++i];
        break;
      case '--host':
        if (!argv[i + 1]) fail('--host requires a hostname');
        opts.host = argv[++i];
        break;
      case 'top':
        opts.command = 'top';
        break;
      default:
        if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
        if (opts.command === 'top') {
          if (/^\d+$/.test(arg)) {
            opts.topIndex = Number(arg);
          } else if (!opts.topCategory) {
            opts.topCategory = arg;
          } else {
            fail(`unexpected argument for top: "${arg}"`);
          }
          break;
        }
        if (opts.url) fail(`too many arguments: expected one URL, got "${arg}"`);
        opts.url = arg;
    }
  }

  if (!opts.url && opts.command !== 'top') {
    process.stderr.write(HELP + '\n');
    process.exit(1);
  }

  opts.color = opts.color && !opts.markdown && process.stdout.isTTY;

  try {
    if (opts.command === 'top') {
      await runTop(opts);
    } else {
      await showArticle(opts.url, opts);
    }
  } catch (err) {
    fail(err.message || String(err));
  }
}

run();