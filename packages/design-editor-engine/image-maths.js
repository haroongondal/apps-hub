// Pure image maths for the quick edits: a six-colour palette (k-means) and Auto-enhance
// slider values (levels stretch). Classic script: the page shares one global scope with
// app.js, so the only top-level names are the two functions; Node loads it with require().

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

if (typeof module === 'object') module.exports = { paletteFromPixels, enhanceValues };
