import type { MediaInfo, Planned, StabilizePlan } from './types.ts';

// The levels are named after CapCut's (Minimum cut, Recommended, Most stable). The search ranges are ours, tuned by hand on shaky test clips:
// shortcut: deshake is FFmpeg's built-in stabilizer, weaker than libvidstab. The upgrade is a pinned build with libvidstab, which is a new binary and needs the owner's yes.
export const STABILIZE_SEARCH: Record<StabilizePlan['level'], number> = { minimum: 8, recommended: 16, most: 40 };

export function planStabilize(info: MediaInfo, level: StabilizePlan['level']): Planned<StabilizePlan> {
  if (!info.tracks.some(t => t.kind === 'video')) return { ok: false, reason: 'invalid', detail: "This file has no video track, so there's nothing to stabilize." };
  return { ok: true, plan: { tool: 'stabilize', level, search: STABILIZE_SEARCH[level], quality: 65, ext: 'mp4' } };
}
