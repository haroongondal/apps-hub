import { dimsFor } from './budget.ts';
import { QUALITY_PRESETS } from './presets.ts';
import type { MediaInfo, Planned, QualityPlan } from './types.ts';

export type QualityName = keyof typeof QUALITY_PRESETS;

export function planQuality(info: MediaInfo, preset: QualityName): Planned<QualityPlan> {
  const video = info.tracks.find(t => t.kind === 'video');
  if (!video?.width || !video.height) return { ok: false, reason: 'no-video' };
  const p = QUALITY_PRESETS[preset];
  const fps = Math.min(video.fps ?? 30, p.maxFps);
  const shortSide = 2 * Math.floor(Math.min(p.maxShortSide, video.width, video.height) / 2);
  const { width, height } = dimsFor(video.width, video.height, shortSide);
  return { ok: true, plan: { tool: 'quality', encoder: 'hw-h264', rung: { shortSide, fps }, width, height, quality: p.vt } };
}
