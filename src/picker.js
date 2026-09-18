'use strict';

// Minimal zero-dependency arrow-key menu. Renders a scrollable list, keeps the
// highlighted row in view, and resolves with the chosen index (or null when
// cancelled). Caller must ensure stdin/stdout are TTYs and raw mode is available.

const ESC = '\x1b[';
const HIDE_CURSOR = ESC + '?25l';
const SHOW_CURSOR = ESC + '?25h';
const CLEAR_LINE = '\r' + ESC + '2K';

function visibleLength(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length;
}

function truncate(str, width) {
  if (visibleLength(str) <= width) return str;
  let out = '';
  let len = 0;
  for (const ch of str) {
    if (ch === '\x1b') break;
    if (len >= width - 1) break;
    out += ch;
    len++;
  }
  return out + '…';
}

function pick(items, options = {}) {
  const out = options.output || process.stdout;
  const input = options.input || process.stdin;
  const header = options.header || '';
  const hint = options.hint || '↑/↓ move · enter open · q quit';
  const label = options.label || ((item) => item.title);
  const color = options.color !== false;

  let selected = Math.max(0, Math.min(options.initial || 0, items.length - 1));
  let start = 0;
  let printed = 0;

  const maxVisible = Math.max(3, Math.min(items.length, (out.rows || 24) - 5));
  const width = out.columns || 80;

  const clampStart = () => {
    const n = Math.min(items.length, maxVisible);
    if (selected < start) start = selected;
    if (selected >= start + n) start = selected - n + 1;
    const maxStart = Math.max(0, items.length - n);
    if (start < 0) start = 0;
    if (start > maxStart) start = maxStart;
  };

  const rowFor = (item, idx) => {
    const num = String(idx + 1).padStart(2);
    const isSel = idx === selected;
    const text = truncate(`${num}. ${label(item)}`, width - 4);
    if (isSel) {
      const mark = color ? ESC + '36m>' + ESC + '0m' : '>';
      const body = color ? ESC + '1m' + text + ESC + '0m' : text;
      return `${mark} ${body}`;
    }
    return `  ${text}`;
  };

  const renderRows = () => {
    const n = Math.min(items.length, maxVisible);
    const lines = [];
    for (let r = 0; r < n; r++) {
      const idx = start + r;
      lines.push(idx < items.length ? rowFor(items[idx], idx) : '');
    }
    return { n, lines };
  };

  const drawInitial = () => {
    clampStart();
    const { n, lines } = renderRows();
    const head = color
      ? ESC + '1m' + header + ESC + '0m  ' + ESC + '90m' + hint + ESC + '0m'
      : `${header}  ${hint}`;
    out.write(head + '\n');
    for (const line of lines) out.write(CLEAR_LINE + line + '\n');
    printed = n;
  };

  const redraw = () => {
    clampStart();
    const { n, lines } = renderRows();
    out.write(ESC + printed + 'A');
    for (const line of lines) out.write(CLEAR_LINE + line + '\n');
    printed = n;
  };

  const clearMenu = () => {
    // Move up over the header + list, wipe every line, leave cursor at the top.
    const total = printed + 1;
    out.write(ESC + total + 'A');
    for (let i = 0; i < total; i++) out.write('\r' + ESC + '2K\n');
    out.write(ESC + total + 'A');
  };

  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  out.write(HIDE_CURSOR);
  drawInitial();

  return new Promise((resolve) => {
    const move = (delta) => {
      const next = Math.max(0, Math.min(selected + delta, items.length - 1));
      if (next === selected) return;
      selected = next;
      redraw();
    };

    const finish = (index) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      clearMenu();
      out.write(SHOW_CURSOR);
      resolve(index);
    };

    const onData = (chunk) => {
      // Normalize SS3 arrow sequences (application cursor mode) to CSI.
      const s = String(chunk).replace(/\x1bO([A-FH])/g, '\x1b[$1');
      let i = 0;
      while (i < s.length) {
        const ch = s[i];
        if (ch === '\x1b') {
          if (s.startsWith('\x1b[A', i)) { move(-1); i += 3; continue; }
          if (s.startsWith('\x1b[B', i)) { move(1); i += 3; continue; }
          if (s.startsWith('\x1b[5~', i)) { move(-maxVisible); i += 4; continue; }
          if (s.startsWith('\x1b[6~', i)) { move(maxVisible); i += 4; continue; }
          if (s.startsWith('\x1b[H', i) || s.startsWith('\x1b[1~', i)) {
            selected = 0; redraw(); i += s.startsWith('\x1b[1~', i) ? 4 : 3; continue;
          }
          if (s.startsWith('\x1b[F', i) || s.startsWith('\x1b[4~', i)) {
            selected = items.length - 1; redraw(); i += s.startsWith('\x1b[4~', i) ? 4 : 3; continue;
          }
          i++;
          continue;
        }
        if (ch === '\r' || ch === '\n') return finish(selected);
        if (ch === '\x03') return finish(null);
        if (ch === 'q' || ch === 'Q') return finish(null);
        if (ch === 'k' || ch === 'K') { move(-1); i++; continue; }
        if (ch === 'j' || ch === 'J') { move(1); i++; continue; }
        i++;
      }
    };

    input.on('data', onData);
  });
}

module.exports = { pick };
