import { planSize } from './budget.ts';
import { planAudio } from './audio.ts';
import { planClip } from './clip.ts';
import { planConvert } from './convert.ts';
import { planFrame } from './frame.ts';
import { planGif } from './gif.ts';
import { planQuality } from './quality.ts';
import { planReverse } from './reverse.ts';
import { planStabilize } from './stabilize.ts';
import { validateSpec, type JobSpec } from './validate.ts';
import { planVolume } from './volume.ts';
import type { MediaInfo, Plan, Planned, Platform } from './types.ts';

export interface PlanContext {
  platform: Platform;
  keyframeS?: number;    // clip: the keyframe at or before the start, found natively
  correction?: number;   // size: the encoder's measured overshoot ratio
}

// One entry for every tool: the same check and planner the Mac uses, with the platform's tables (SPEC §5.2).
export function planFor(spec: JobSpec, info: MediaInfo, ctx: PlanContext): Planned<Plan> {
  const errors = validateSpec(spec, info, ctx.platform);
  if (errors.length) return { ok: false, reason: 'invalid', detail: errors.join(' ') };
  switch (spec.tool) {
    case 'size': return planSize(info, spec.targetBytes, spec.encoder, { correction: ctx.correction, maxFps: 30 });
    case 'quality': return planQuality(info, spec.preset, ctx.platform);
    case 'clip': return planClip(info, spec.startS, spec.endS, ctx.keyframeS ?? spec.startS, spec.mode, ctx.platform);
    case 'audio': {
      const track = info.tracks.find(t => t.index === spec.trackIndex);
      return track ? planAudio(track, ctx.platform) : { ok: false, reason: 'invalid', detail: 'Pick a sound track in this file.' };
    }
    case 'gif': return planGif(info, spec);
    case 'convert': return planConvert(info, spec.target, { videoCodec: spec.videoCodec, muted: spec.muted === true }, ctx.platform);
    case 'frame': return planFrame(info, spec.timeS, spec.format);
    case 'volume': return planVolume(info, spec.mode, spec.gainDb);
    case 'reverse': return planReverse(info, spec.sound);
    case 'stabilize': return planStabilize(info, spec.level);
  }
}
