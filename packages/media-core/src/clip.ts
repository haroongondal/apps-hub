import type { ClipPlan, MediaInfo, Planned } from './types.ts';

// keyframeS is the keyframe at or before startS, found by the caller with ffprobe. A copy starts there (PRD FR-5).
export function planClip(info: MediaInfo, startS: number, endS: number, keyframeS: number, mode: 'copy' | 'exact'): Planned<ClipPlan> {
  if (!info.tracks.some(t => t.kind === 'video')) return { ok: false, reason: 'no-video' };
  if (!(startS >= 0 && endS > startS)) return { ok: false, reason: 'invalid', detail: 'The end must come after the start.' };
  const container = info.container === 'mov' || info.container === 'mkv' || info.container === 'webm' ? info.container : 'mp4';
  const tracks = info.tracks.filter(t => t.kind === 'video' || t.kind === 'audio').map(t => t.index);
  return {
    ok: true,
    plan: {
      tool: 'clip', mode, startS, endS, keyframeS: Math.min(keyframeS, startS), container, ext: container, tracks,
    },
  };
}
