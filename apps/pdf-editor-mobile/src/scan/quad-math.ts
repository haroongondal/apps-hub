import type { Quad } from 'pdf-scan';

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** 1 or -1 when every turn goes the same way, 0 for a bow-tie, a degenerate corner or a bad array. */
function turn(q: readonly number[]): 1 | -1 | 0 {
  if (q.length !== 8 || q.some((v) => !Number.isFinite(v))) return 0;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = [q[i * 2], q[i * 2 + 1]];
    const [bx, by] = [q[((i + 1) % 4) * 2], q[((i + 1) % 4) * 2 + 1]];
    const [cx, cy] = [q[((i + 2) % 4) * 2], q[((i + 2) % 4) * 2 + 1]];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    const s = Math.sign(cross);
    if (s === 0 || (sign !== 0 && s !== sign)) return 0;
    sign = s;
  }
  return sign as 1 | -1;
}

export const isConvex = (quad: readonly number[]): boolean => turn(quad) !== 0;

export function moveCorner(quad: Quad, index: 0 | 1 | 2 | 3, x: number, y: number): Quad {
  const next = [...quad] as Quad;
  next[index * 2] = clamp(x);
  next[index * 2 + 1] = clamp(y);
  const t = turn(next);
  const was = turn(quad);
  return t === 0 || (was !== 0 && t !== was) ? quad : next;
}
