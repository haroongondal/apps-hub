import type { Locator, Segment } from './types.ts';

export const MAX_CHUNK = 1200; // characters

function merged(a: Locator, b: Locator): Locator | undefined {
  if (a === null && b === null) return null;
  if (a && b && 'page' in a && 'page' in b) return a.page === b.page ? a : undefined;
  if (a && b && 'startSec' in a && 'startSec' in b) return { startSec: a.startSec, endSec: b.endSec };
  return undefined;
}

function split(text: string, max: number): string[] {
  const out: string[] = [];
  let t = text;
  while (t.length > max) {
    let cut = t.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    out.push(t.slice(0, cut).trim());
    t = t.slice(cut).trim();
  }
  if (t) out.push(t);
  return out;
}

/** Joins short neighbours on the same page or consecutive transcript segments; splits long ones. */
export function chunkSegments(segments: readonly Segment[], max = MAX_CHUNK): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    for (const piece of split(seg.text.replace(/\s+/g, ' ').trim(), max)) {
      const last = out[out.length - 1];
      const joined = last && last.text.length + 1 + piece.length <= max ? merged(last.locator, seg.locator) : undefined;
      if (last && joined !== undefined) out[out.length - 1] = { text: `${last.text} ${piece}`, locator: joined };
      else out.push({ text: piece, locator: seg.locator });
    }
  }
  return out;
}
