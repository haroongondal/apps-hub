export interface Range { startS: number; endS: number }

export const MIN_RANGE_S = 0.1;
export const MAX_PX_PER_S = 240;

const STEPS_S = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const usable = (durationS: number) => Number.isFinite(durationS) && durationS > 0;

export const snapTenth = (s: number): number => Math.round(s * 10) / 10;

export function moveEdge(range: Range, edge: 'start' | 'end', toS: number, durationS: number, minS = MIN_RANGE_S): Range {
  if (!usable(durationS) || !Number.isFinite(toS)) return range;
  if (edge === 'start') return { startS: snapTenth(Math.min(Math.max(toS, 0), range.endS - minS)), endS: range.endS };
  return { startS: range.startS, endS: snapTenth(Math.max(Math.min(toS, durationS), range.startS + minS)) };
}

export function zoomLimits(durationS: number, viewPx: number): { min: number; max: number } {
  if (!usable(durationS) || !(viewPx > 0)) return { min: 1, max: MAX_PX_PER_S };
  return { min: Math.min(viewPx / durationS, MAX_PX_PER_S), max: MAX_PX_PER_S };
}

export function clampZoom(pxPerS: number, durationS: number, viewPx: number): number {
  const { min, max } = zoomLimits(durationS, viewPx);
  return Math.min(max, Math.max(min, pxPerS));
}

export function rulerStepS(pxPerS: number, minGapPx = 56): number {
  return STEPS_S.find(s => s * pxPerS >= minGapPx) ?? STEPS_S[STEPS_S.length - 1];
}

// Capped at 60 so a two-hour video does not ask the native side for thousands of pictures.
export function thumbCount(durationS: number, pxPerS: number, tilePx = 48): number {
  const wanted = usable(durationS) ? Math.ceil((durationS * pxPerS) / tilePx) : 0;
  return Math.min(60, Math.max(6, wanted));
}

export function thumbTimes(durationS: number, count: number): number[] {
  if (!usable(durationS) || !(count > 0)) return [];
  return Array.from({ length: count }, (_, i) => (durationS * (i + 0.5)) / count);
}

export function barsFor(peaks: number[], count: number): number[] {
  const n = peaks.length;
  if (!n || !(count > 0)) return [];
  return Array.from({ length: count }, (_, i) => {
    const lo = Math.floor((i * n) / count);
    const hi = Math.max(lo + 1, Math.ceil(((i + 1) * n) / count));
    return Math.max(...peaks.slice(lo, hi));
  });
}
