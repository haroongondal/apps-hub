import { dimsFor } from './budget.ts';
import { QUALITY_PRESETS } from './presets.ts';
import { projectProblem, totalS, type Project } from './project.ts';
import type { ComposePlan, Planned } from './types.ts';

const PRESET = QUALITY_PRESETS.medium;
const AUDIO_BPS = 192_000;

export function outputSize(p: Project): { width: number; height: number } {
  const s = p.clips[0]?.source;
  if (!s) return { width: 0, height: 0 };
  return dimsFor(s.width, s.height, 2 * Math.floor(Math.min(PRESET.maxShortSide, s.width, s.height) / 2));
}

export function planCompose(p: Project): Planned<ComposePlan> {
  const problem = projectProblem(p);
  if (problem) return { ok: false, reason: 'invalid', detail: problem };
  const { width, height } = outputSize(p);
  const fps = Math.round(Math.min(PRESET.maxFps, Math.max(...p.clips.map(c => c.source.fps))));
  const videoBps = Math.round(width * height * fps * PRESET.bpp);
  return {
    ok: true,
    plan: {
      tool: 'compose',
      clips: p.clips.map(c => ({ uri: c.source.uri, name: c.source.name, inS: c.inS, outS: c.outS, hasAudio: c.source.hasAudio })),
      width, height, fps, videoBps,
      plannedBytes: Math.ceil(((videoBps + AUDIO_BPS) / 8) * totalS(p)),
      ext: 'mp4',
    },
  };
}
