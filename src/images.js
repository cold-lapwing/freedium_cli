'use strict';

// Terminal image rendering across Linux, macOS and Windows terminals.
// Zero runtime dependencies.
//
// Strategies (best first, platform-aware):
//   1. iterm2 — iTerm2 inline images (OSC 1337) on macOS, no decode
//   2. kitty  — kitty graphics protocol (kitty, WezTerm; raw bytes, no decode)
//   3. ansi   — universal half-block rendering (GNOME Terminal, Konsole, Windows
//               with an installed decoder) via a system decoder (magick → convert →
//               chafa → viu → img2txt → jp2a)
//   4. text   — the classic [image: alt] placeholder (used when piped / unsupported)

const { spawnSync } = require('node:child_process');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) freediumcli';

function resolveImageUrl(src, host) {
  src = (src || '').trim();
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) return 'https://' + (host || 'freedium-mirror.cfd') + src;
  return src;
}

async function fetchImage(url, signal) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'image/*' },
    signal,
  });
  if (!res.ok) throw new Error('image fetch failed: HTTP ' + res.status);
  const format = (res.headers.get('content-type') || '').split(';')[0].trim().split('/')[1] ||
    (url.match(/\.(png|jpe?g|gif|webp|avif)$/i) || [])[1] || 'png';
  return { buffer: Buffer.from(await res.arrayBuffer()), format };
}

// ---- tiny zero-dep image header parsers ----

function readImageSize(buf) {
  if (buf.length < 24) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  // WebP (RIFF....WEBP)
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const vp8 = buf.toString('ascii', 12, 16);
    if (vp8 === 'VP8 ' && buf.length >= 30) return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (vp8 === 'VP8L' && buf.length >= 25) return { w: (buf.readUInt16LE(21) & 0x3fff) + 1, h: (buf.readUInt16LE(23) & 0x3fff) + 1 };
    if (vp8 === 'VP8X' && buf.length >= 30) return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      if (marker === 0xff || marker === 0x00) { o++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5) };
      }
      const len = buf.readUInt16BE(o + 2);
      if (len < 2) break;
      o += 2 + len;
    }
  }
  return null;
}

// ---- decoder discovery ----

const DECODER_CANDIDATES = ['magick', 'convert', 'chafa', 'viu', 'img2txt', 'jp2a'];

let decoderCache = null;

function findDecoder() {
  if (decoderCache !== null) return decoderCache;
  for (const cmd of DECODER_CANDIDATES) {
    const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 });
    if (!r.error && r.status === 0) {
      decoderCache = cmd;
      return cmd;
    }
  }
  decoderCache = '';
  return '';
}

// ---- mode detection ----

function isIterm2() {
  // iTerm2 on macOS uses TERM_PROGRAM=iTerm.app (or historically
  // "iTerm.app"). The protocol also de-facto works in WezTerm when the
  // OSC 1337 handler is enabled, but we only pick iterm2 mode when we
  // detect a native iTerm2 session so users don't get garbled output
  // elsewhere.
  const tp = (process.env.TERM_PROGRAM || '').toLowerCase();
  if (tp === 'iterm.app' || tp === 'iterm2.app' || tp === 'iterm') return true;
  return false;
}

function supportsSixel() {
  // VTE 0.78+ powers GNOME Terminal / GNOME Console 47+ and Konsole's sixel
  // support; explicit sixel TERMs (foot, mlterm, ghostty, …) also qualify.
  if (Number(process.env.VTE_VERSION) >= 7800) return true;
  const t = (process.env.TERM || '').toLowerCase();
  return t.includes('sixel') || ['foot', 'mlterm', 'ghostty', 'contour'].includes(t);
}

function isKitty() {
  const t = (process.env.TERM || '').toLowerCase();
  return !!(process.env.KITTY_WINDOW_ID || t.includes('kitty') || process.env.TERM_PROGRAM === 'WezTerm');
}

// transforms an override into a usable mode given the current terminal and the
// user's OS preference (see src/os.js).
function detectMode(override, opts) {
  if (override && override !== 'auto') return override;
  if (!opts.useColor || !opts.isTTY) return 'text';

  // Explicit override already handled above. For 'auto', prefer the
  // protocol that matches the user's actual terminal/OS.
  if (opts.os === 'macos' || opts.os === 'darwin') {
    if (isIterm2()) return 'iterm2';
    // macOS can also run kitty/WezTerm; fall through to generic detection.
  }
  if (opts.os === 'windows') {
    // Windows terminals have no native image protocol in this codebase.
    // Only render when a system decoder is available (ansicon, wsl, etc.).
    if (!findDecoder()) return 'text';
    // keep 'ansi' below only if decoder present
  }
  if (isKitty()) return 'kitty';
  if (supportsSixel()) return 'sixel';
  return 'ansi';
}

// transforms an override into a usable mode given the current terminal
function resolveMode(override, opts) {
  const mode = detectMode(override, {
    useColor: opts.useColor,
    isTTY: opts.isTTY,
    os: opts.os,
  });
  const noDecoder = () => ({ mode: 'text', decoder: '', note: 'no image decoder found (install imagemagick, chafa, viu, img2txt or jp2a)' });

  if (mode === 'text') return { mode: 'text', decoder: '', note: false };

  if (mode === 'iterm2') {
    // iTerm2 has built-in image support; no system decoder needed.
    if (isIterm2()) return { mode, decoder: '', note: false };
    return noDecoder();
  }

  const decoder = findDecoder();

  if (mode === 'kitty') {
    if (isKitty()) return { mode, decoder: '', note: false }; // kitty/WezTerm native
    if (!decoder) return noDecoder();
    const fallback = 'ansi';
    return { mode: fallback, decoder, note: 'kitty graphics not supported by this terminal; using ' + fallback };
  }

  if (mode === 'sixel') {
    const decoder = findSixelDecoder();
    if (decoder) return { mode: 'sixel', decoder, note: false };
    return noDecoder();
  }

  // ansi
  if (decoder) return { mode: 'ansi', decoder, note: false };
  return noDecoder();
}

// ---- sizing ----

// Map the image onto the terminal grid: one cell displays 1×2 source pixels
// (top half = foreground, bottom half = background). When no target width is
// given, default to the full terminal width so images stay crisp.
function imageGrid(w, h, targetCols, termCols, termLines) {
  termLines = termLines || process.stdout.rows || 40;
  const cl = (v) => Math.max(8, Math.min(v, termCols - 2, w));
  let cols = cl(targetCols == null ? termCols - 2 : targetCols);
  let rowsPx = Math.max(2, Math.round((cols * h) / w));
  const cap = Math.min(cols * 2, Math.max(16, Math.floor(termLines * 0.9) - 4) * 2);
  rowsPx = Math.min(rowsPx, cap);
  cols = cl(Math.round((rowsPx * w) / h));
  rowsPx = Math.max(2, Math.round((cols * h) / w));
  if (rowsPx > cap) rowsPx = cap;
  return { cols, rows: rowsPx, lines: Math.ceil(rowsPx / 2) };
}

// ---- ansi half-block via a system decoder ----

function runDecoder(cmd, args, input) {
  return spawnSync(cmd, args, { input, maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
}

function pixelAt(rgb, x, y, cols) {
  const o = (y * cols + x) * 3;
  return [rgb[o], rgb[o + 1], rgb[o + 2]];
}

function ansiHalfBlock(buf, decoder, grid) {
  const { cols, rows } = grid;
  const resize = `${cols}x${rows}!`;

  if (decoder === 'magick' || decoder === 'convert') {
    // Lanczos resampling keeps edges smooth when downscaling instead of the
    // blocky nearest-neighbour look; a gentle unsharp mask restores crispness
    // lost to the tiny half-block canvas.
    const r = runDecoder(
      decoder,
      ['-', '-filter', 'Lanczos', '-resize', resize, '-unsharp', '0x0.5+0.6+0.05', '-depth', '8', 'RGB:-'],
      buf
    );
    if (r.error || r.status !== 0) return null;
    const rgb = r.stdout;
    if (!rgb || rgb.length < cols * rows * 3) return null;

    const lines = [];
    for (let y = 0; y < rows; y += 2) {
      let line = '  ';
      for (let x = 0; x < cols; x++) {
        const [fr, fg, fb] = pixelAt(rgb, x, y, cols);
        const [br, bg, bb] = y + 1 < rows ? pixelAt(rgb, x, y + 1, cols) : [0, 0, 0];
        line += `\x1b[38;2;${fr};${fg};${fb}m\x1b[48;2;${br};${bg};${bb}m▀`;
      }
      line += '\x1b[0m';
      lines.push(line);
    }
    return lines;
  }

  // chafa / viu / img2txt / jp2a already emit their own ANSI/char output
  const sizeArgs =
    decoder === 'chafa' ? ['--format', 'symbols', '--colors', 'full', '--size', `${cols}x${lines}`]
    : decoder === 'viu' ? ['-w', String(cols)]
    : decoder === 'img2txt' ? ['-W', String(cols), '-H', String(lines)]
    : ['-W', String(cols * 2), '-H', String(rows)];
  const r = runDecoder(decoder, sizeArgs, buf);
  if (r.error || r.status !== 0) return null;
  const text = r.stdout.toString('utf8').replace(/\n+$/, '');
  if (!text.trim()) return null;
  return text.split('\n').map((l) => l.replace(/\s+$/, ''));
}

// ---- iTerm2 inline images (OSC 1337) — macOS ----

// iTerm2-specific image rendering via OSC 1337 (https://iterm2.com/documentation-images.html).
// The image is sent as base64 in a single File transfer sequence; the terminal
// decodes it natively (supports PNG, JPEG, GIF, WebP on macOS).
function iterm2Image(buf, format, grid) {
  const b64 = buf.toString('base64');
  // width/height can be given as character cells ("N"), pixels ("Npx") or
  // "auto". We render at the grid width in character cells so the image fills
  // the console width — iTerm2 will upscale/downscale accordingly.
  const size = readImageSize(buf);
  const width = size ? Math.max(160, grid.cols * 2) + 'px' : 'auto';
  const height = size ? Math.round((size.h * grid.cols * 2) / size.w) + 'px' : 'auto';
  const args = [
    'inline=1',
    'preserveAspectRatio=1',
    'width=' + width,
    'height=' + height,
  ].join(';');
  // OSC 1337 ; File = args : base64  BEL
  return '\x1b]1337;File=' + args + ':' + b64 + '\x07';
}

// ---- kitty graphics protocol ----

function kittyImage(buf, format, grid) {
  const fmt = { png: 100, jpg: 101, jpeg: 101, gif: 103, webp: 104 }[format] || '100';
  const b64 = buf.toString('base64');
  const id = 'f1';
  const chunk = 4096;
  let out = `\x1b_Ga=T,i=${id},f=${fmt},s=${buf.length},v=1;${b64.slice(0, chunk)}\x1b\\`;
  for (let o = chunk; o < b64.length; o += chunk) {
    out += `\x1b_Gm=1;${b64.slice(o, o + chunk)}\x1b\\`;
  }
  out += `\x1b_Ge=1\x1b\\`;
  out += `\x1b_Ga=p,i=${id},c=${grid.cols},r=${grid.lines}\x1b\\`;
  return out;
}

// ---- sixel (GNOME Terminal / GNOME Console 47+, foot, mlterm, …) ----

let sixelDecoderCache = null;

function findSixelDecoder() {
  if (sixelDecoderCache !== null) return sixelDecoderCache;
  const probe = spawnSync('img2sixel', ['--help'], { stdio: 'ignore', timeout: 5000 });
  if (!probe.error && probe.status === 0) {
    sixelDecoderCache = 'img2sixel';
    return sixelDecoderCache;
  }
  const d = findDecoder();
  sixelDecoderCache = ['magick', 'convert', 'chafa', 'viu'].includes(d) ? d : '';
  return sixelDecoderCache;
}

// Renders the image as a sixel bitmap at roughly one cell = 8 source pixels
// wide, so it displays at near-native resolution instead of half-block blocks.
function renderSixel(buf, decoder, grid) {
  if (decoder === 'img2sixel') {
    const r = runDecoder(decoder, ['-w', String(Math.max(320, grid.cols * 8)), '-'], buf);
    if (!r.error && r.status === 0 && r.stdout.toString('utf8').includes('\x1bP')) {
      return ['', r.stdout.toString('utf8').replace(/\n+$/, ''), ''];
    }
    return null;
  }
  if (decoder === 'chafa') {
    const r = runDecoder(decoder, ['--format', 'sixel', '--size', `${grid.cols}x${grid.lines}`, '-'], buf);
    if (!r.error && r.status === 0 && r.stdout.toString('utf8').includes('\x1bP')) {
      return ['', r.stdout.toString('utf8').replace(/\n+$/, ''), ''];
    }
    return null;
  }
  if (decoder === 'viu') {
    const r = runDecoder(decoder, ['-w', String(grid.cols), '-'], buf);
    if (!r.error && r.status === 0 && r.stdout.toString('utf8').includes('\x1bP')) {
      return ['', r.stdout.toString('utf8').replace(/\n+$/, ''), ''];
    }
    return null;
  }
  if (decoder === 'magick' || decoder === 'convert') {
    return renderSixelFromRgb(buf, decoder, grid);
  }
  return null;
}

function renderSixelFromRgb(buf, decoder, grid) {
  const size = readImageSize(buf);
  if (!size || !size.w || !size.h) return null;
  const tw = Math.max(80, Math.min(grid.cols * 8, 1600));
  const th = Math.max(20, Math.round((tw * size.h) / size.w));
  const r = runDecoder(decoder, ['-', '-filter', 'Lanczos', '-resize', `${tw}x${th}!`, '-depth', '8', 'RGB:-'], buf);
  if (r.error || r.status !== 0) return null;
  const rgb = r.stdout;
  if (!rgb || rgb.length < tw * th * 3) return null;
  const { rgbToSixel } = require('./sixel.js');
  return ['', rgbToSixel(rgb, tw, th, 256), ''];
}

module.exports = { resolveImageUrl, fetchImage, readImageSize, findDecoder, findSixelDecoder, detectMode, resolveMode, imageGrid, renderSixel, ansiHalfBlock, kittyImage, iterm2Image, isIterm2 };