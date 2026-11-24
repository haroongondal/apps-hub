// Pure image maths for the quick edits: a six-colour palette (k-means) and Auto-enhance
// slider values (levels stretch), and the Upscale plan with its time estimate. Classic script: the
// page shares one global scope with app.js, so the only top-level names are these functions;
// Node loads it with require().

// k distinct "#rrggbb" colours, biggest cluster first; [] when no pixel is visible (alpha < 128).
function paletteFromPixels(px, k = 6) {
  const pts = [];
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 128) pts.push(px[i], px[i + 1], px[i + 2]);
  const n = pts.length / 3;
  if (!n) return [];
  const d2 = (i, c) => (pts[i] - c[0]) ** 2 + (pts[i + 1] - c[1]) ** 2 + (pts[i + 2] - c[2]) ** 2;
  // first centre: mean of the fullest 4-bit-per-channel bucket
  const bucket = new Map();
  for (let i = 0; i < pts.length; i += 3) {
    const key = ((pts[i] >> 4) << 8) | ((pts[i + 1] >> 4) << 4) | (pts[i + 2] >> 4);
    const b = bucket.get(key) || [0, 0, 0, 0];
    b[0] += pts[i]; b[1] += pts[i + 1]; b[2] += pts[i + 2]; b[3]++;
    bucket.set(key, b);
  }
  let top = null;
  for (const b of bucket.values()) if (!top || b[3] > top[3]) top = b;
  const centres = [[top[0] / top[3], top[1] / top[3], top[2] / top[3]]];
  // farthest-point seeding; the lowest pixel index wins a tie
  const farthest = () => {
    let best = -1, bd = -1;
    for (let i = 0; i < pts.length; i += 3) {
      let m = Infinity;
      for (const c of centres) m = Math.min(m, d2(i, c));
      if (m > bd) { bd = m; best = i; }
    }
    return [pts[best], pts[best + 1], pts[best + 2]];
  };
  while (centres.length < k) centres.push(farthest());
  const owner = new Int16Array(n).fill(-1);
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (let p = 0; p < n; p++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = d2(p * 3, centres[c]);
        if (d < bd) { bd = d; bi = c; }
      }
      if (owner[p] !== bi) { owner[p] = bi; changed = true; }
    }
    if (!changed) break;
    const sum = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let p = 0; p < n; p++) {
      const s = sum[owner[p]];
      s[0] += pts[p * 3]; s[1] += pts[p * 3 + 1]; s[2] += pts[p * 3 + 2]; s[3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sum[c][3]) centres[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
      else centres[c] = farthest(); // empty cluster: reseed
    }
  }
  const size = new Array(k).fill(0);
  for (let p = 0; p < n; p++) size[owner[p]]++;
  const rgb = centres
    .map((c, i) => ({ c: c.map((v) => Math.round(v)), n: size[i], i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((e) => e.c);
  const far = (c, list) => list.every((o) => Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]) >= 16);
  const out = [];
  for (const c of rgb) if (far(c, out)) out.push(c);
  // pad with lighter and darker mixes of the kept colours
  for (let i = 0; i < out.length && out.length < k; i++) {
    for (const t of [[255, 0.3], [0, 0.3], [255, 0.55], [0, 0.55], [255, 0.8], [0, 0.8]]) {
      const c = out[i].map((v) => Math.round(v + (t[0] - v) * t[1]));
      if (out.length < k && far(c, out)) out.push(c);
    }
  }
  return out.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
}

// Brightness and Contrast slider values (multiples of 0.02) that stretch the photo's tones.
function enhanceValues(px) {
  const hist = new Array(256).fill(0);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    hist[Math.min(255, Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]))]++;
    n++;
  }
  const none = { brightness: 0, contrast: 0 };
  if (!n) return none;
  const at = (q) => { let s = 0; for (let v = 0; v < 256; v++) if ((s += hist[v]) >= q * n) return v; return 255; };
  const lo = at(0.01), hi = at(0.99);
  if (hi - lo < 8) return none;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const F = clamp(223 / (hi - lo), 1, 1.6);
  const brightness = clamp((128 - (lo + hi) / 2) / 255, -0.24, 0.24); // 0.24 both ways: rounding 12.5 steps would give +0.26 but -0.24
  // inverse of Fabric's contrast factor F = 1.015(c+1)/(1.015-c)
  const contrast = Math.min((1.015 * (F - 1)) / (F + 1.015), 0.3);
  const step = (v) => Math.round(v * 50) / 50 || 0; // "|| 0" turns -0 into 0
  return { brightness: step(brightness), contrast: step(contrast) };
}

// Upscale on the phone (owner rule 2026-11-18, mirrors upscalePlan in Kotlin UpscaleMaths.kt): the
// model input is the photo (4x) or a half-size copy (2x), shrunk to at most 1024 px; the output is
// exactly 4x the input. null (refused) when the longest side is already 4096 px or more.
function upscaleEstimate(w, h, scale) {
  if (Math.max(w, h) >= 4096) return null;
  // Kotlin Math.rint: halves go to the even neighbour
  const rint = (x) => { const r = Math.round(x); return r - x === 0.5 && r % 2 ? r - 1 : r; };
  let inW = scale === 2 ? Math.max(1, rint(w / 2)) : w, inH = scale === 2 ? Math.max(1, rint(h / 2)) : h;
  const l = Math.max(inW, inH);
  if (l > 1024) [inW, inH] = [Math.max(1, rint((inW * 1024) / l)), Math.max(1, rint((inH * 1024) / l))];
  const tiles = Math.ceil(inW / 128) * Math.ceil(inH / 128), seconds = tiles * 1.9; // 1.9 s per tile, measured on the phone
  const tens = Math.round(seconds / 10) * 10, min = Math.round(seconds / 60);
  const label = seconds < 10 ? 'A few seconds' : tens < 60 ? `About ${tens} seconds` : `About ${min} ${min === 1 ? 'minute' : 'minutes'}`;
  return { inW, inH, outW: 4 * inW, outH: 4 * inH, tiles, seconds, label };
}

// The dominant colours of an RGBA image the caller already shrank (<= 128 px a side): median cut over
// 5-bit-per-channel buckets, so the same pixels always give the same answer. Pixels with alpha < 128
// are skipped. Returns [{ hex, share }], biggest first, shares summing to 1; fewer than `count` when the
// image has fewer distinct colours, and [] when nothing is visible. Colours closer than 24 (RGB distance)
// merge into the bigger one.
function extractPalette(px, { count = 6, width, height } = {}) {
  if (width && height && px.length !== width * height * 4) throw new RangeError('pixels do not match width and height');
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    const b = buckets.get(key) || { key, n: 0, sum: [0, 0, 0] };
    b.n++; b.sum[0] += px[i]; b.sum[1] += px[i + 1]; b.sum[2] += px[i + 2];
    buckets.set(key, b);
    total++;
  }
  if (!total) return [];
  const mean = (b, ch) => b.sum[ch] / b.n;
  const size = (box) => box.reduce((s, b) => s + b.n, 0);
  const boxes = [[...buckets.values()].sort((a, b) => a.key - b.key)];
  const widest = (box) => {
    const spans = [0, 1, 2].map((ch) => Math.max(...box.map((b) => mean(b, ch))) - Math.min(...box.map((b) => mean(b, ch))));
    return spans.indexOf(Math.max(...spans));
  };
  while (boxes.length < count) {
    let at = -1;
    boxes.forEach((box, i) => { if (box.length > 1 && (at < 0 || size(box) > size(boxes[at]))) at = i; });
    if (at < 0) break;
    const box = boxes[at], ch = widest(box);
    box.sort((a, b) => mean(a, ch) - mean(b, ch) || a.key - b.key);
    let seen = 0, cut = 0;
    while (cut < box.length - 1 && seen + box[cut].n <= size(box) / 2) seen += box[cut++].n;
    cut = Math.max(1, cut);
    boxes.splice(at, 1, box.slice(0, cut), box.slice(cut));
  }
  const hexOf = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const found = boxes.map((box) => {
    const n = size(box);
    return { n, rgb: [0, 1, 2].map((ch) => box.reduce((s, b) => s + b.sum[ch], 0) / n) };
  }).sort((a, b) => b.n - a.n || hexOf(a.rgb).localeCompare(hexOf(b.rgb)));
  const kept = [];
  for (const c of found) {
    const near = kept.find((k) => Math.hypot(...c.rgb.map((v, i) => v - k.rgb[i])) < 24);
    if (near) near.n += c.n; else kept.push({ ...c });
  }
  return kept
    .map((c) => ({ hex: hexOf(c.rgb), share: c.n / total, n: c.n }))
    .sort((a, b) => b.n - a.n || a.hex.localeCompare(b.hex))
    .map(({ hex, share }) => ({ hex, share }));
}

// WCAG 2.x contrast ratio (1 to 21) of two "#rrggbb" colours.
function contrastRatio(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// How readable text is on a colour: the ratio with white and with black, the better of the two, and
// whether it reaches 4.5 (WCAG AA for body text). Ties go to black.
function contrastOf(hex) {
  const white = contrastRatio(hex, '#ffffff'), black = contrastRatio(hex, '#000000');
  const useWhite = white > black;
  const ratio = useWhite ? white : black;
  return { white, black, text: useWhite ? '#ffffff' : '#000000', ratio, aa: ratio >= 4.5 };
}

if (typeof module === 'object') module.exports = { paletteFromPixels, enhanceValues, upscaleEstimate, extractPalette, contrastRatio, contrastOf };
