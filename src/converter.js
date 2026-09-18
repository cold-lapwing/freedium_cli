'use strict';

// A tiny HTML → Markdown converter that targets the well-formed HTML
// that freedium produces (markdown rendered into a `.prose` container).
// Zero dependencies on purpose: tokenizes with a recursive-descent
// parser instead of pulling in cheerio/turndown.

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'pre', 'blockquote', 'hr', 'table', 'figure',
]);

const VOID_TAGS = new Set(['br', 'img', 'hr', 'wbr', 'input', 'source', 'track', 'area', 'meta', 'link']);

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    attrs[m[1].toLowerCase()] = decodeEntities(raw);
  }
  return attrs;
}

// Find the closing `>` of a tag, ignoring `>` inside quoted attribute values.
// Some sources (e.g. copy-button `data-code="<EventData> ..."`) embed raw `<`
// and `>` in attributes, which desyncs a naive indexOf('>').
function findTagEnd(html, start) {
  let quote = null;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function tokenize(html) {
  const tokens = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const c = html[i];

    if (c !== '<') {
      const lt = html.indexOf('<', i);
      const text = html.slice(i, lt === -1 ? n : lt);
      if (text) tokens.push({ type: 'text', value: decodeEntities(text) });
      i = lt === -1 ? n : lt;
      continue;
    }

    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }

    const gt = findTagEnd(html, i + 1);
    if (gt === -1) {
      tokens.push({ type: 'text', value: decodeEntities(html.slice(i)) });
      break;
    }

    let raw = html.slice(i + 1, gt).trim();
    let type = 'open';

    if (raw.startsWith('/')) {
      type = 'close';
      raw = raw.slice(1).trim();
    } else if (raw.endsWith('/')) {
      raw = raw.slice(0, -1).trim();
    }

    const spaceIdx = raw.search(/[\s/]/);
    const tag = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toLowerCase();
    if (!tag) {
      i = gt + 1;
      continue;
    }

    if (type === 'open' && VOID_TAGS.has(tag)) type = 'self';

    const attrs = type === 'close' ? {} : parseAttrs(raw.slice(spaceIdx === -1 ? raw.length : spaceIdx));

    tokens.push({ type, tag, attrs });
    i = gt + 1;
  }

  return tokens;
}

function collapseWs(str) {
  return str.replace(/\s+/g, ' ');
}

function codeFence(md, lang) {
  const runs = [...md.matchAll(/`+/g)].map((m) => m[0].length);
  const maxRun = runs.length ? Math.max(...runs) : 0;
  const f = '`'.repeat(Math.max(3, maxRun + 1));
  return `${f}${lang || ''}\n${md.trimEnd()}\n${f}\n\n`;
}

function inlineCode(md) {
  const runs = [...md.matchAll(/`+/g)].map((m) => m[0].length);
  const maxRun = runs.length ? Math.max(...runs) : 0;
  const f = '`'.repeat(maxRun + 1);
  return `${f}${md}${f}`;
}

function prefixLines(text, prefix) {
  return text
    .split('\n')
    .map((line) => (line.trim() ? prefix + line : line))
    .join('\n');
}

function escapeLink(text) {
  return text.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/"/g, '%22');
}

function headingLevel(tag) {
  return tag.length === 2 ? Number(tag[1]) : 0;
}

class Converter {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
    this.anchorDepth = 0;
  }

  // mode: 'flow' (block level) | 'inline' | 'code' (raw text)
  render(stopTag, mode) {
    let out = '';
    const t = this.tokens;

    while (this.i < t.length) {
      const tok = t[this.i];

      if (tok.type === 'close') {
        if (tok.tag === stopTag) {
          this.i++;
          return out;
        }
        this.i++;
        continue;
      }

      if (tok.type === 'text') {
        if (mode === 'code') {
          out += tok.value;
        } else {
          const collapsed = collapseWs(tok.value);
          if (mode === 'inline' || collapsed.trim()) out += collapsed;
        }
        this.i++;
        continue;
      }

      if (tok.type === 'self') {
        this.i++;
        if (mode === 'code') continue;
        switch (tok.tag) {
          case 'br':
            out += mode === 'inline' ? '  \n' : '\n';
            break;
          case 'hr':
            out += '\n---\n\n';
            break;
          case 'img':
            out += this.renderImage(tok.attrs);
            if (mode === 'flow') out += '\n\n';
            break;
          default:
            break;
        }
        continue;
      }

      // open tag
      const tag = tok.tag;

      if (mode === 'code') {
        this.i++;
        continue;
      }

      if (tag === 'a') {
        const nested = this.anchorDepth > 0;
        this.anchorDepth++;
        this.i++;
        const inner = this.render(tag, 'inline');
        this.anchorDepth--;
        const href = tok.attrs.href || '';
        const text = inner.trim();
        // Don't wrap when the anchor already contains markdown link/image
        // syntax (nested anchors, clickable images): markdown cannot nest
        // link brackets cleanly, so emitting it would leak raw syntax.
        const hasNested = /!\[|\]\(/.test(text);
        if (nested || hasNested || !href || !text) {
          out += text;
        } else {
          out += `[${text}](${escapeLink(href)})`;
        }
        continue;
      }

      if (['strong', 'b'].includes(tag)) {
        this.i++;
        const inner = this.render(tag, 'inline').trim();
        out += inner ? `**${inner}**` : '';
        continue;
      }
      if (['em', 'i'].includes(tag)) {
        this.i++;
        const inner = this.render(tag, 'inline').trim();
        out += inner ? `*${inner}*` : '';
        continue;
      }
      if (tag === 'code') {
        this.i++;
        const raw = this.render(tag, 'code');
        out += inlineCode(raw.trim());
        continue;
      }
      if (tag === 'mark') {
        this.i++;
        const inner = this.render(tag, 'inline').trim();
        out += inner ? `==${inner}==` : '';
        continue;
      }
      if (['s', 'del', 'strike'].includes(tag)) {
        this.i++;
        const inner = this.render(tag, 'inline').trim();
        out += inner ? `~~${inner}~~` : '';
        continue;
      }
      if (tag === 'sub') {
        this.i++;
        out += `~${this.render(tag, 'inline').trim()}~`;
        continue;
      }
      if (tag === 'sup') {
        this.i++;
        out += `^${this.render(tag, 'inline').trim()}^`;
        continue;
      }
      if (tag === 'kbd') {
        this.i++;
        out += inlineCode(this.render(tag, 'inline').trim());
        continue;
      }

      // Block-level handling applies only in flow mode.
      if (mode === 'flow') {
        out += this.renderBlock(tok);
        continue;
      }

      // Nested block inside inline context (e.g. <p> inside <li>/<td>):
      // bail out to flow mode; the caller will handle the block.
      if (BLOCK_TAGS.has(tag)) {
        return out;
      }

      // Transparent inline container (span, div, etc.)
      this.i++;
      out += this.render(tag, 'inline');
    }

    return out;
  }

  renderBlock(tok) {
    const tag = tok.tag;

    if (tag === 'p') {
      this.i++;
      const inner = this.render(tag, 'inline').trim();
      return inner ? inner + '\n\n' : '';
    }

    if (/^h[1-6]$/.test(tag)) {
      this.i++;
      const inner = this.render(tag, 'inline').trim();
      return inner ? '#'.repeat(headingLevel(tag)) + ' ' + inner + '\n\n' : '';
    }

    if (tag === 'ul' || tag === 'ol') {
      return this.renderList(tok);
    }

    if (tag === 'pre') {
      return this.renderPre(tok);
    }

    if (tag === 'blockquote') {
      this.i++;
      const inner = this.render(tag, 'flow').replace(/\n+$/, '');
      if (!inner.trim()) return '';
      return prefixLines(inner, '> ') + '\n\n';
    }

    if (tag === 'figure') {
      this.i++;
      const inner = this.render(tag, 'flow');
      return inner.endsWith('\n\n') ? inner : inner + '\n\n';
    }

    if (tag === 'table') {
      return this.renderTable();
    }

    if (tag === 'hr') {
      this.i++;
      return '---\n\n';
    }

    if (tag === 'details') {
      this.i++;
      const inner = this.render(tag, 'flow');
      return inner ? inner + '\n' : '';
    }

    if (tag === 'summary') {
      this.i++;
      const inner = this.render(tag, 'inline').trim();
      return inner ? `**${inner}**\n\n` : '';
    }

    // Transparent containers
    this.i++;
    return this.render(tag, 'flow');
  }

  renderList(tok) {
    const isOl = tok.tag === 'ol';
    this.i++;
    let out = '';
    let counter = 1;

    while (this.i < this.tokens.length) {
      const cur = this.tokens[this.i];

      if (cur.type === 'close' && cur.tag === tok.tag) {
        this.i++;
        break;
      }
      if (cur.type === 'open' && cur.tag === 'li') {
        this.i++;
        const body = this.render('li', 'flow').trimEnd();
        if (body) {
          const marker = isOl ? `${counter}. ` : '- ';
          const indented = body
            .split('\n')
            .map((line, idx) => (idx === 0 ? marker + line : '  ' + line))
            .join('\n');
          out += indented + '\n';
        }
        counter++;
        continue;
      }
      if (cur.type === 'text' && !cur.value.trim()) {
        this.i++;
        continue;
      }
      this.i++;
    }

    return out ? out + '\n' : '';
  }

  renderPre(tok) {
    this.i++;
    let lang = '';
    let code = '';

    while (this.i < this.tokens.length) {
      const cur = this.tokens[this.i];

      if (cur.type === 'close' && cur.tag === 'pre') {
        this.i++;
        break;
      }
      if (cur.type === 'open' && cur.tag === 'code') {
        const cls = cur.attrs.class || '';
        const m = cls.match(/language-([\w+-]+)/);
        if (m && !lang) lang = m[1];
        this.i++;
        code += this.render('code', 'code');
        continue;
      }
      if (cur.type === 'text') {
        code += cur.value;
        this.i++;
        continue;
      }
      this.i++;
    }

    const lines = code.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.length ? codeFence(lines.join('\n'), lang) : '';
  }

  renderImage(attrs) {
    const src = attrs.src || '';
    let alt = (attrs.alt || '').trim();
    if (/^none$/i.test(alt)) alt = '';
    if (!src) return alt || '';
    if (/[{}<>\s]/.test(src)) return alt || '';
    const dims =
      attrs.width && attrs.height && /^\d+$/.test(attrs.width) && /^\d+$/.test(attrs.height)
        ? ` "${attrs.width}x${attrs.height}"`
        : '';
    return `![${alt}](${escapeLink(src)}${dims})`;
  }

  renderTable() {
    this.i++;
    const rows = [];
    let headerCount = 0;
    let inThead = false;
    let seenHeader = false;

    while (this.i < this.tokens.length) {
      const cur = this.tokens[this.i];

      if (cur.type === 'close') {
        if (cur.tag === 'table') {
          this.i++;
          break;
        }
        if (cur.tag === 'thead') {
          inThead = false;
          seenHeader = true;
        }
        this.i++;
        continue;
      }
      if (cur.type === 'open' && cur.tag === 'thead') {
        inThead = true;
        this.i++;
        continue;
      }
      if (cur.type === 'open' && cur.tag === 'tr') {
        this.i++;
        const cells = this.renderTableRow();
        if (inThead && !seenHeader && !headerCount) headerCount = cells.length;
        rows.push(cells);
        continue;
      }
      this.i++;
    }

    if (!headerCount) {
      headerCount = rows[0] ? rows[0].length : 0;
    }
    if (!rows.length) return '';

    const clean = rows.map((r) => r.map((cell) => cell.trim()));
    if (headerCount === 0) {
      return clean.map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';
    }

    const widths = Array.from({ length: headerCount }, () => 0);
    for (const row of clean) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i], cell.replace(/\|/g, '\\|').length);
      });
    }

    const fmtRow = (cells) =>
      '| ' +
      cells
        .map((c, i) => {
          const esc = c.replace(/\|/g, '\\|');
          return esc + ' '.repeat(Math.max(0, widths[i] - esc.length));
        })
        .join(' | ') +
      ' |';

    const sep = '| ' + widths.map((w) => '-'.repeat(w + 2)).join(' | ') + ' |';

    const lines = [fmtRow(clean[0]), sep];
    for (let r = 1; r < clean.length; r++) lines.push(fmtRow(clean[r]));
    return lines.join('\n') + '\n\n';
  }

  renderTableRow() {
    this.i++;
    const cells = [];
    let cellText = '';

    while (this.i < this.tokens.length) {
      const cur = this.tokens[this.i];

      if (cur.type === 'close') {
        if (cur.tag === 'tr') {
          this.i++;
          if (cellText.trim()) cells.push(cellText.trim());
          return cells;
        }
        this.i++;
        continue;
      }
      if (cur.type === 'open' && (cur.tag === 'td' || cur.tag === 'th')) {
        if (cellText.trim()) cells.push(cellText.trim());
        this.i++;
        cellText = this.render(cur.tag, 'inline');
        continue;
      }
      if (cur.type === 'text') {
        cellText += cur.value;
      }
      this.i++;
    }

    if (cellText.trim()) cells.push(cellText.trim());
    return cells;
  }
}

function htmlToMarkdown(html) {
  if (!html || typeof html !== 'string') return '';
  const tokens = tokenize(html);
  const converter = new Converter(tokens);
  const md = converter.render(null, 'flow');
  return md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

module.exports = { htmlToMarkdown, tokenize };