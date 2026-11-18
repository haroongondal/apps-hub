export const toBlob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));

// Copies first: a driver may hand back a view at an offset that isn't 4-byte aligned.
export const fromBlob = (b: Uint8Array): Float32Array => new Float32Array(b.slice().buffer);

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0; // vectors from another model never match
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function topK<T>(items: readonly T[], score: (t: T) => number, k: number): { item: T; score: number }[] {
  return items
    .map((item) => ({ item, score: score(item) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}
