export const EMBED_DIMS = 512;
export const EMBED_MODEL = 'gemini-embedding-001';
/** Stored beside the vectors: when it changes, Knowledge re-embeds every item. */
export const EMBED_TAG = `${EMBED_MODEL}@${EMBED_DIMS}`;

// Gemini only normalises full-size vectors, so cut to EMBED_DIMS and re-normalise ourselves.
export const unit = (v: number[] | Float32Array): Float32Array => {
  const out = Float32Array.from(v.slice(0, EMBED_DIMS));
  const n = Math.hypot(...out) || 1;
  return out.map((x) => x / n);
};
