// Pure image maths for the quick edits: the Upscale plan and its time estimate. Classic script:
// the page shares one global scope with app.js, so the only top-level name is upscaleEstimate;
// Node loads it with require().

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

if (typeof module === 'object') module.exports = { upscaleEstimate };
