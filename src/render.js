'use strict';

// Markdown → terminal formatter. Pure ANSI, no dependencies.
// Produces freedium-branded (teal) styled output when colors are enabled,
// otherwise clean readable plain text.

const {
  resolveImageUrl,
  fetchImage,
  readImageSize,
  resolveMode,
  imageGrid,
  renderSixel,
  ansiHalfBlock,
  kittyImage,
  iterm2Image,
} = require('./images.js');

const ESC = '\x1b[';

const C = {
  reset: ESC + '0m',
  bold: ESC + '1m',
  dim: ESC + '2m',
  italic: ESC + '3m',
  underline: ESC + '4m',
  strike: ESC + '9m',
  red: ESC + '31m',
  green: ESC + '32m',
  yellow: ESC + '33m',
  blue: ESC + '34m',
  magenta: ESC + '35m',
  cyan: ESC + '36m',
  teal: ESC + '38;2;0;171;169m',
  brightRed: ESC + '91m',
  brightGreen: ESC + '92m',
  brightYellow: ESC + '93m',
  brightBlue: ESC + '94m',
  brightMagenta: ESC + '95m',
  brightCyan: ESC + '96m',
  brightWhite: ESC + '97m',
  bgBlack: ESC + '40m',
  bgBrightWhite: ESC + '107m',
  black: ESC + '30m',
  grey: ESC + '90m',
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLen(str) {
  return str.replace(ANSI_RE, '').length;
}

const RULE_CHAR = '─';

class Renderer {
  constructor(opts = {}) {
    this.color = !!opts.color;
    this.width = (opts.width || process.stdout.columns || 80) - 0;
    this.w = this.width;
    this.host = opts.host || null;
    this.imageWidth = opts.imageWidth != null ? opts.imageWidth : null;
    this.imageIndicator = opts.image || 'auto';
    this.os = opts.os || null;
    this.rows = opts.rows || process.stdout.rows || 40;
    this._imageCfg = null;
    this._imageNoteShown = false;
  }

  imageConfig() {
    if (this._imageCfg) return this._imageCfg;
    const cfg = resolveMode(this.imageIndicator, {
      useColor: this.color,
      isTTY: this.isTTY,
      os: this.os,
    });
    if (cfg.note && !this._imageNoteShown) {
      this._imageNoteShown = true;
      process.stderr.write('⚠ ' + cfg.note + '\n');
    }
    this._imageCfg = cfg;
    return cfg;
  }

  set isTTY(v) {
    this._isTTY = !!v;
    this._imageCfg = null;
  }

  get isTTY() {
    return this._isTTY !== undefined ? this._isTTY : !!process.stdout.isTTY;
  }

  imagePlaceholder(alt, src) {
    return ['', this.fmt('dim', '[ image ] ' + (alt || '')), this.fmt('grey', src), ''];
  }

  async renderImageBlock(src, alt) {
    const cfg = this.imageConfig();
    const placeholder = () => this.imagePlaceholder(alt, src);
    if (cfg.mode === 'text' || !src) return placeholder();

    const url = resolveImageUrl(src, this.host);
    let buffer;
    let format;
    try {
      const res = await fetchImage(url);
      buffer = res.buffer;
      format = res.format;
    } catch (err) {
      return placeholder();
    }

    try {
      const size = readImageSize(buffer);
      const grid = imageGrid(
        size ? size.w : 4,
        size ? size.h : 3,
        this.imageWidth,
        this.w,
        this.rows
      );

      if (cfg.mode === 'kitty') {
        return ['', kittyImage(buffer, format, grid), ''];
      }

      if (cfg.mode === 'iterm2') {
        return ['', iterm2Image(buffer, format, grid), ''];
      }

      if (cfg.mode === 'sixel') {
        const sixel = renderSixel(buffer, cfg.decoder, grid);
        if (sixel) return sixel;
      }

      const rows = ansiHalfBlock(buffer, cfg.decoder || require('./images.js').findDecoder(), grid);
      if (!rows || !rows.length) return placeholder();
      return ['', ...rows, ''];
    } catch (err) {
      return placeholder();
    }
  }

  fmt(style, text) {
    if (!this.color) return text;
    const styles = Array.isArray(style) ? style : [style];
    let prefix = '';
    for (const s of styles) prefix += C[s] || '';
    return prefix + text + C.reset;
  }

  rule() {
    return this.color ? C.dim + RULE_CHAR.repeat(Math.max(1, this.w)) + C.reset : ''.padEnd(this.w, RULE_CHAR);
  }

  wrap(text, width) {
    width = width || this.w;
    const tokens = text.match(/\x1b\[[0-9;]*m|[\S]+|\s+/g) || [];
    const lines = [];
    let line = '';
    let len = 0;

    for (const tok of tokens) {
      if (/^\x1b/.test(tok)) {
        line += tok;
        continue;
      }
      const tLen = visibleLen(tok);
      if (tok.trim() === '') {
        // whitespace: collapse to a single space
        if (len + 1 > width && len > 0) {
          lines.push(line);
          line = '';
          len = 0;
        } else if (len > 0) {
          line += ' ';
          len += 1;
        }
        continue;
      }
      // word
      if (len + tLen > width && len > 0) {
        lines.push(line);
        line = '';
        len = 0;
      }
      line += tok;
      len += tLen;
    }

    if (line.trim() !== '' || lines.length === 0) lines.push(line.trimEnd());
    return lines;
  }

  formatInline(text) {
    const regex =
      /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)|!\[([^\]]*)\]\(([^)]+)\)|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|==(.+?)==|\^(.+?)\^|~([^~\n]+?)~|(`+)([^`]*?)\1|\[([^\]]*)\]\(([^)]+)\)/g;

    let out = '';
    let last = 0;
    let m;

    while ((m = regex.exec(text)) !== null) {
      out += text.slice(last, m.index);
      const [
        , linkedAlt, linkedSrc, linkedHref,
        imgAlt, imgSrc,
        boldItalic, bold, strike, italic, mark, sup, sub,
        _fence, code, linkText, linkUrl,
      ] = m;

      if (linkedSrc !== undefined) {
        out += this.fmt('dim', '[image: ' + (linkedAlt || '') + ']');
        if (this.color && linkedHref) out += C.dim + ' (' + linkedHref + ')' + C.reset;
        out += ' ';
      } else if (imgSrc !== undefined) {
        out += this.fmt('dim', '[image: ' + (imgAlt || '') + ']');
        out += ' ';
        out += this.fmt('grey', imgSrc);
      } else if (boldItalic !== undefined) {
        out += this.fmt(['teal', 'bold', 'italic'], this.formatInline(boldItalic));
      } else if (bold !== undefined) {
        out += this.fmt(['teal', 'bold'], this.formatInline(bold));
      } else if (strike !== undefined) {
        out += this.fmt(['grey', 'strike'], this.formatInline(strike));
      } else if (italic !== undefined) {
        out += this.fmt(['cyan', 'italic'], this.formatInline(italic));
      } else if (mark !== undefined) {
        out += this.fmt(['black', 'bgBrightWhite'], mark);
      } else if (sup !== undefined) {
        out += this.fmt('dim', '^' + sup + '^');
      } else if (sub !== undefined) {
        out += this.fmt('dim', '~' + sub + '~');
      } else if (code !== undefined) {
        out += this.fmt('yellow', code);
      } else {
        out += this.fmt(['blue', 'underline'], this.formatInline(linkText));
        if (this.color) {
          out += C.dim + ' (' + linkUrl + ')' + C.reset;
        }
      }
      last = m.index + m[0].length;
    }

    out += text.slice(last);
    return out;
  }

  paragraph(text, indent) {
    indent = indent || 0;
    const inner = this.wrap(this.formatInline(text), this.w - indent);
    if (!inner.length) return [];
    const pad = ' '.repeat(indent);
    return inner.map((l) => pad + l);
  }

  heading(text, level) {
    let styled = this.formatInline(text);
    if (level === 1) styled = this.fmt(['teal', 'bold', 'underline'], styled);
    else if (level === 2) styled = this.fmt(['teal', 'bold'], styled);
    else styled = this.fmt(['cyan', 'bold'], styled);
    return this.wrap(styled, this.w);
  }

  listItem(text, marker, indent) {
    const indentStr = ' '.repeat(indent);
    const markerStr = this.color ? C.teal + marker + C.reset : marker;
    const first = indentStr + markerStr;
    const avail = this.w - indent - marker.length - 1;
    const inner = this.wrap(this.formatInline(text), avail);
    const pad = ' '.repeat(indent + marker.length + 1);
    const out = [];
    inner.forEach((line, idx) => {
      out.push(idx === 0 ? first + line : pad + line);
    });
    return out;
  }

  codeBlock(code, lang) {
    const lines = code.split('\n');
    const out = [];
    if (lang) {
      out.push(this.fmt('dim', '┌ ' + lang));
    }
    for (const line of lines) {
      out.push(this.fmt('grey', '│ ' + line));
    }
    out.push(this.fmt('dim', '└'));
    out.push('');
    return out;
  }

  blockquote(text) {
    const inner = this.wrap(this.formatInline(text.replace(/\n/g, ' ')), this.w - 4);
    return inner.map((l) => this.fmt(['grey', 'italic'], '  │ ' + l.trimStart()));
  }

  table(rows) {
    if (!rows.length) return [];
    const clean = rows.map((r) => r.filter((c) => c !== undefined));
    const cols = Math.max(...clean.map((r) => r.length));
    const widths = Array.from({ length: cols }, () => 0);

    for (const row of clean) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i], visibleLen(this.formatInline(cell)));
      });
    }

    const pad = (cell, i) => {
      const styled = this.formatInline(cell || '');
      return styled + ' '.repeat(widths[i] - visibleLen(styled));
    };

    const renderRow = (row, isHeader) => {
      const cells = [];
      for (let i = 0; i < cols; i++) {
        cells.push(isHeader && this.color ? this.fmt(['teal', 'bold'], pad(row[i], i)) : pad(row[i], i));
      }
      const d = (s) => this.dimIfColor(s);
      return '  ' + d('│') + ' ' + cells.join(' ' + d('│') + ' ') + ' ' + d('│');
    };

    const sepLine =
      '  ' + this.dimIfColor('├') + widths.map((w) => this.dimIfColor('─'.repeat(w + 2))).join(this.dimIfColor('┼')) + this.dimIfColor('┤');

    const out = [renderRow(clean[0], true)];
    if (clean.length > 1) {
      out.push(sepLine);
      for (let i = 1; i < clean.length; i++) out.push(renderRow(clean[i], false));
    }
    return out;
  }

  dimIfColor(str) {
    return this.color ? C.dim + str + C.reset : str;
  }
}

async function renderMarkdown(payload, opts) {
  const r = new Renderer(opts);
  const out = [];

  // ---- header ----
  if (payload.title) {
    r.heading(payload.title, 1).forEach((l) => out.push(l));
  }

  const meta = [];
  if (payload.author) meta.push(payload.author);
  if (payload.readingTime) meta.push(payload.readingTime);
  if (payload.date) meta.push(payload.date);
  if (meta.length) {
    out.push('');
    out.push(r.fmt('dim', meta.join('  ·  ')));
  }

  // ---- body ----
  const body = await renderBody(payload.markdown, r);
  if (body.length) {
    out.push('');
    out.push(r.rule());
    out.push('');
    out.push(...body);
  }

  // ---- footer ----
  out.push(r.fmt('dim', '— via freedium (' + (payload.host || 'freedium-mirror.cfd') + ')'));
  return out.join('\n');
}

async function renderBody(markdown, r) {
  const out = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (line.trim() === '') {
      i++;
      continue;
    }

    // fenced code
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // fence close
      out.push(...r.codeBlock(buf.join('\n').replace(/\n+$/, ''), lang));
      continue;
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push('');
      out.push(...r.heading(h[2], h[1].length));
      out.push('');
      i++;
      continue;
    }

    // hr
    if (/^-{3,}$/.test(line.trim())) {
      out.push(r.dimIfColor(RULE_CHAR.repeat(r.w)));
      out.push('');
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(...r.blockquote(buf.join(' ').trim()));
      out.push('');
      continue;
    }

    // ordered list
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    if (ol) {
      const marker = ol[1] + '. ';
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\d+)\.\s+(.*)$/);
        if (m) {
          items.push({ text: m[2], marker: m[1] + '.' });
          i++;
        } else if (lines[i].trim() === '' || /^\s+.*\S/.test(lines[i])) {
          // continuation of previous item: gather further indented lines
          if (items.length) {
            const cont = [];
            while (i < lines.length && (lines[i].trim() === '' || /^\s{2,}\S/.test(lines[i]))) {
              if (lines[i].trim()) cont.push(lines[i].trim());
              else if (cont.length) break;
              i++;
            }
            if (cont.length) items[items.length - 1].text += ' ' + cont.join(' ');
            else break;
          } else break;
        } else {
          break;
        }
      }
      for (const item of items) out.push(...r.listItem(item.text, item.marker + ' ', 0));
      out.push('');
      continue;
    }

    // unordered list
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^[-*+]\s+(.*)$/);
        if (m) {
          items.push({ text: m[1], marker: '-' });
          i++;
        } else if (lines[i].trim() === '' || /^\s+.*\S/.test(lines[i])) {
          if (items.length) {
            const cont = [];
            while (i < lines.length && (lines[i].trim() === '' || /^\s{2,}\S/.test(lines[i]))) {
              if (lines[i].trim()) cont.push(lines[i].trim());
              else if (cont.length) break;
              i++;
            }
            if (cont.length) items[items.length - 1].text += ' ' + cont.join(' ');
            else break;
          } else break;
        } else {
          break;
        }
      }
      for (const item of items) out.push(...r.listItem(item.text, item.marker + ' ', 0));
      out.push('');
      continue;
    }

    // table
    if (/^\s*\|/.test(line)) {
      const rows = [];
      const collect = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
        collect.push(cells);
        i++;
      }
      // detect header separator row like | --- | --- |
      if (collect.length >= 2 && /^[\s:|-]*$/.test(collect[1].join('')) && collect[1].join('').includes('-')) {
        rows.push(collect[0]);
        for (let k = 2; k < collect.length; k++) rows.push(collect[k]);
      } else {
        rows.push(...collect);
      }
      out.push(...r.table(rows));
      out.push('');
      continue;
    }

    // image on its own line
    const img = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (img) {
      const block = await r.renderImageBlock(img[2], img[1]);
      out.push(...block);
      i++;
      continue;
    }

    // plain paragraph (may span lines until blank / block start)
    const para = [line];
    i++;
    while (i < lines.length) {
      const nxt = lines[i];
      if (nxt.trim() === '') break;
      if (/^(```|#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|^\s*\|)/.test(nxt)) break;
      para.push(nxt.trim());
      i++;
    }
    out.push(...r.paragraph(para.join(' ')));
    out.push('');
  }

  return out;
}

module.exports = { renderMarkdown, Renderer };