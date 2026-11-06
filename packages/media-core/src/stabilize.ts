import type { MediaInfo, Planned, StabilizePlan } from './types.ts';

// The levels are named after CapCut's (Minimum cut, Recommended, Most stable). The phone's FFmpeg 8.1 refuses any deshake rx/ry that is not a multiple of 16
// ("rx must be a multiple of 16", seen in logcat on 2026-11-05), and 64 is the filter's maximum, so 16, 32 and 64 are the only steps that run.
// Passes decide how steady the result is, the range does not: on a synthetic shaky clip (2026-11-06) two passes cut the frame-to-frame difference about 14% more than one, more add nothing, and 16, 32 and 64 steady alike.
// shortcut: deshake is weaker than libvidstab, which is GPL and a new binary: the upgrade needs the owner's yes and a licence check (PRD NFR-8).
export const STABILIZE_SEARCH: Record<StabilizePlan['level'], number> = { minimum: 16, recommended: 32, most: 64 };
export const STABILIZE_PASSES: Record<StabilizePlan['level'], number> = { minimum: 1, recommended: 2, most: 2 };

export function planStabilize(info: MediaInfo, level: StabilizePlan['level']): Planned<StabilizePlan> {
  if (!info.tracks.some(t => t.kind === 'video')) return { ok: false, reason: 'invalid', detail: "This file has no video track, so there's nothing to stabilize." };
  return { ok: true, plan: { tool: 'stabilize', level, search: STABILIZE_SEARCH[level], quality: 65, ext: 'mp4' } };
}
