import type { FramePlan, MediaInfo, Planned } from './types.ts';

// A still frame needs a video track; the time is checked against the file's length by validateSpec.
export function planFrame(info: MediaInfo, timeS: number, format: 'png' | 'jpg'): Planned<FramePlan> {
  if (!info.tracks.some(t => t.kind === 'video')) return { ok: false, reason: 'no-video' };
  return { ok: true, plan: { tool: 'frame', timeS, format, ext: format } };
}
