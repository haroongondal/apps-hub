import type { LoudnessMeasure, MediaInfo, Planned, VolumePlan } from './types.ts';

// EBU R128 target. CapCut's loudness option uses the same -23 LUFS figure, per its help pages.
export const LOUDNESS_TARGET_LUFS = -23;
export const GAIN_LIMIT_DB = 20;

export function planVolume(info: MediaInfo, mode: 'normalize' | 'gain', gainDb: number): Planned<VolumePlan> {
  const video = info.tracks.find(t => t.kind === 'video');
  if (!info.tracks.some(t => t.kind === 'audio')) return { ok: false, reason: 'invalid', detail: 'This file has no audio to change.' };
  // The picture is copied when it can go into an MP4 as it is; anything else is re-encoded to H.264.
  const copy = video !== undefined && (video.codec === 'h264' || video.codec === 'hevc');
  return {
    ok: true,
    plan: {
      tool: 'volume', mode, gainDb: mode === 'gain' ? gainDb : 0,
      ...(video ? { video: copy ? 'copy' : 'hw-h264' } : {}),
      ext: video ? 'mp4' : 'm4a',
    },
  };
}

// loudnorm's first pass prints this JSON at the end of stderr. Missing or non-numeric fields mean the measure failed.
export function parseLoudnorm(stderr: string): LoudnessMeasure | undefined {
  const json = /\{[\s\S]*\}/.exec(stderr);
  if (!json) return undefined;
  let fields: Record<string, unknown>;
  try { fields = JSON.parse(json[0]); } catch { return undefined; }
  const v = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].map(k => Number(fields[k]));
  if (!v.every(Number.isFinite)) return undefined;
  return { inputI: v[0], inputTp: v[1], inputLra: v[2], inputThresh: v[3], offset: v[4] };
}
