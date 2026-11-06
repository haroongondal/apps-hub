import { androidContainerFor } from './remux.ts';
import type { ClipPlan, MediaInfo, Planned, Platform } from './types.ts';

// keyframeS is the keyframe at or before startS, found by the caller with ffprobe. A copy starts there (PRD FR-5).
export function planClip(info: MediaInfo, startS: number, endS: number, keyframeS: number, mode: 'copy' | 'exact', platform: Platform = 'mac'): Planned<ClipPlan> {
  if (!info.tracks.some(t => t.kind === 'video')) return { ok: false, reason: 'no-video' };
  if (!(startS >= 0 && endS > startS)) return { ok: false, reason: 'invalid', detail: 'The end must come after the start.' };
  // Android copies into MP4 or WebM only; a re-encode (exact) always writes MP4.
  const own = androidContainerFor(info);
  if (platform === 'android' && mode === 'copy' && !own) {
    return { ok: false, reason: 'invalid', detail: "This video's sound can't be copied on this phone. Use Exact instead." };
  }
  const container = platform === 'android' ? (mode === 'copy' ? own! : 'mp4')
    : info.container === 'mov' || info.container === 'mkv' || info.container === 'webm' ? info.container : 'mp4';
  const tracks = info.tracks.filter(t => t.kind === 'video' || t.kind === 'audio').map(t => t.index);
  return {
    ok: true,
    plan: {
      tool: 'clip', mode, startS, endS, keyframeS: Math.min(keyframeS, startS), container, ext: container, tracks,
    },
  };
}
