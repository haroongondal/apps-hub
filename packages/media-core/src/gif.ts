import type { GifPlan, MediaInfo, Planned } from './types.ts';

export const GIF_WARN_S = 15;
export const GIF_MAX_S = 60;

// Each rung is smaller than the one before (RESEARCH §7); a fit-under-size GIF steps down this list.
export const GIF_LADDER: readonly { width: number; fps: number }[] = [
  { width: 480, fps: 12 }, { width: 360, fps: 12 }, { width: 320, fps: 10 }, { width: 240, fps: 10 },
];

export interface GifOptions { startS: number; endS: number; width: number; fps: number; targetBytes?: number }

export function planGif(info: MediaInfo, opts: GifOptions): Planned<GifPlan> {
  if (!info.tracks.some(t => t.kind === 'video')) return { ok: false, reason: 'no-video' };
  const length = opts.endS - opts.startS;
  if (!(opts.startS >= 0 && length > 0)) return { ok: false, reason: 'invalid', detail: 'The end must come after the start.' };
  if (length > GIF_MAX_S) return { ok: false, reason: 'invalid', detail: `GIFs are capped at ${GIF_MAX_S} seconds. Shorten the range.` };
  return {
    ok: true,
    plan: { tool: 'gif', startS: opts.startS, endS: opts.endS, width: opts.width, fps: opts.fps, targetBytes: opts.targetBytes, attempt: 1 },
  };
}

export function nextGifAttempt(plan: GifPlan, actualBytes: number): Planned<GifPlan> {
  if (plan.targetBytes === undefined || actualBytes <= plan.targetBytes) return { ok: true, plan };
  if (plan.attempt >= 4) return { ok: false, reason: 'gave-up' };
  const next = GIF_LADDER.find(r => r.width <= plan.width && r.fps <= plan.fps && (r.width < plan.width || r.fps < plan.fps));
  if (!next) return { ok: false, reason: 'gave-up' };
  return { ok: true, plan: { ...plan, width: next.width, fps: next.fps, attempt: plan.attempt + 1 } };
}
