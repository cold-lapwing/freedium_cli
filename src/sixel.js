'use strict';

// Pure-JS sixel encoder. Zero dependencies.
//
// Input: raw 8-bit RGB triplets (as ImageMagick's `-depth 8 RGB:-` produces).
// Output: a single DEC sixel DCS (`ESC P 0;1;0 q  ...  ESC \`) using the
// classic straightforward rasterization: one palette color per 6-row column,
// painted with `#<color>` + `~<mask>` (OR) only — no `?` AND masks, which
// several terminals (VTE included) handle poorly.

const CH = (v) => String.fromCharCode(0x3f + v);

function buildPalette(rgb, w, h, maxColors) {
  const hist = new Map();
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const k = (rgb[o] << 16) | (rgb[o + 1] << 8) | rgb[o + 2];
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const unique = [...hist.keys()];
  if (unique.length <= maxColors) return unique.map((k) => [k >> 16 & 255, (k >> 8) & 255, k & 255]);

  const comp = (k, c) => (k >> (c * 8)) & 255;
  const chanRange = (keys, c) => {
    let lo = 255;
    let hi = 0;
    for (const k of keys) {
      const v = comp(k, c);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  };
  const splitChan = (keys) => {
    let c = 0;
    let best = -1;
    for (let i = 0; i < 3; i++) {
      const r = chanRange(keys, i);
      if (r > best) {
        best = r;
        c = i;
      }
    }
    return c;
  };

  let boxes = [{ keys: unique }];
  while (boxes.length < maxColors) {
    let bi = -1;
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.keys.length <= 1) continue;
      const r = chanRange(b.keys, splitChan(b.keys));
      if (r > best) {
        best = r;
        bi = i;
      }
    }
    if (bi < 0) break;
    const b = boxes[bi];
    const c = splitChan(b.keys);
    b.keys.sort((a, z) => comp(a, c) - comp(z, c));
    const mid = Math.floor(b.keys.length / 2);
    boxes.splice(bi, 1, { keys: b.keys.slice(0, mid) }, { keys: b.keys.slice(mid) });
  }

  const palette = [];
  for (const b of boxes) {
    let r = 0;
    let g = 0;
    let bl = 0;
    let n = 0;
    for (const k of b.keys) {
      const c = hist.get(k) || 1;
      r += (k >> 16 & 255) * c;
      g += ((k >> 8) & 255) * c;
      bl += (k & 255) * c;
      n += c;
    }
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(bl / n)]);
  }
  return palette;
}

// Bucket index -> nearest palette color, via a 5-bit-per-channel LUT so pixel
// lookup is O(1) instead of O(palette).
function buildLookup(palette) {
  const N = 32; // 5 bits per channel
  const lut = new Int16Array(N * N * N);
  for (let r = 0; r < N; r++) {
    for (let g = 0; g < N; g++) {
      for (let b = 0; b < N; b++) {
        const cr = r * 8 + 4;
        const cg = g * 8 + 4;
        const cb = b * 8 + 4;
        let best = 0;
        let bd = Infinity;
        for (let p = 0; p < palette.length; p++) {
          const dr = cr - palette[p][0];
          const dg = cg - palette[p][1];
          const db = cb - palette[p][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        lut[(r << 10) | (g << 5) | b] = best;
      }
    }
  }
  return lut;
}

function rgbToSixel(rgb, w, h, maxColors) {
  const palette = maxColors < 1 ? [...Array(0)] : buildPalette(rgb, w, h, maxColors);
  const lut = buildLookup(palette);
  const idx = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const key = ((rgb[o] >> 3) << 10) | ((rgb[o + 1] >> 3) << 5) | (rgb[o + 2] >> 3);
    idx[i] = lut[key];
  }

  const bands = Math.ceil(h / 6);
  let out = '\x1bP0;1;0q' + `"1;1;${w};${h}`;
  for (let p = 0; p < palette.length; p++) {
    out += `#${p};2;${Math.round((palette[p][0] * 100) / 255)};${Math.round((palette[p][1] * 100) / 255)};${Math.round((palette[p][2] * 100) / 255)}`;
  }

  // Each 6-row band is painted lane by lane: one pen per active row, using
  // `$` (return to column 0 of the same line) to compose sub-6-pixel colour
  // variation exactly like libsixel / ImageMagick do.
  for (let by = 0; by < bands; by++) {
    for (let lane = 0; lane < 6; lane++) {
      const y = by * 6 + lane;
      if (y >= h) break;
      if (lane > 0) out += '$';
      let active = -1;
      const mask = CH(1 << lane);
      for (let x = 0; x < w; x++) {
        const c = idx[y * w + x];
        if (active !== c) {
          out += `#${c}`;
          active = c;
        }
        out += mask;
      }
    }
    out += '\n';
  }
  out += '\x1b\\';
  return out;
}

module.exports = { rgbToSixel, buildPalette };