import type { MediaInfo, Planned, ReversePlan } from './types.ts';

// shortcut: reverse holds every decoded frame in memory. Measured peak at the cap: 1.05 GB (10 s, 1080p30, FFmpeg 9.0.2). Chunked reverse is the upgrade for longer clips.
export const REVERSE_MAX_S = 10;
export const REVERSE_MAX_WIDTH = 1920;
export const REVERSE_MAX_HEIGHT = 1080;

// Shared by the validator and the planner, so the reason shown before a job is the one the planner gives.
export function reverseProblem(info: MediaInfo): string | undefined {
  const video = info.tracks.find(t => t.kind === 'video');
  if (!video) return 'Reverse needs a video track.';
  if (info.durationS > REVERSE_MAX_S + 0.05) return `Reverse works on clips up to ${REVERSE_MAX_S} seconds. Clip the part you need first, then reverse the clip.`;
  if ((video.width ?? 0) > REVERSE_MAX_WIDTH || (video.height ?? 0) > REVERSE_MAX_HEIGHT) {
    return `Reverse works up to ${REVERSE_MAX_WIDTH}×${REVERSE_MAX_HEIGHT} in this version.`;
  }
  return undefined;
}

export function planReverse(info: MediaInfo, sound: boolean): Planned<ReversePlan> {
  const problem = reverseProblem(info);
  if (problem) return { ok: false, reason: 'invalid', detail: problem };
  return { ok: true, plan: { tool: 'reverse', sound, quality: 65, ext: 'mp4' } };
}
