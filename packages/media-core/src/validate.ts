import { GIF_MAX_S } from './gif.ts';
import { reverseProblem } from './reverse.ts';
import { GAIN_LIMIT_DB } from './volume.ts';
import type { ConvertTarget, Encoder, MediaInfo, Platform } from './types.ts';

export interface SizeSpec { tool: 'size'; inputId: string; targetBytes: number; encoder: Encoder }
export interface QualitySpec { tool: 'quality'; inputId: string; preset: 'high' | 'medium' | 'small' }
export interface ClipSpec { tool: 'clip'; inputId: string; startS: number; endS: number; mode: 'copy' | 'exact' }
export interface AudioSpec { tool: 'audio'; inputId: string; trackIndex: number }
export interface GifSpec { tool: 'gif'; inputId: string; startS: number; endS: number; width: number; fps: number; targetBytes?: number }
export interface ConvertSpec { tool: 'convert'; inputId: string; target: ConvertTarget; videoCodec: 'h264' | 'hevc'; muted?: boolean }
export interface FrameSpec { tool: 'frame'; inputId: string; timeS: number; format: 'png' | 'jpg' }
export interface VolumeSpec { tool: 'volume'; inputId: string; mode: 'normalize' | 'gain'; gainDb: number }
export interface ReverseSpec { tool: 'reverse'; inputId: string; sound: boolean }
export interface StabilizeSpec { tool: 'stabilize'; inputId: string; level: 'minimum' | 'recommended' | 'most' }
export type JobSpec = SizeSpec | QualitySpec | ClipSpec | AudioSpec | GifSpec | ConvertSpec | FrameSpec | VolumeSpec | ReverseSpec | StabilizeSpec;

const MIN_TARGET_BYTES = 1_000_000;
const ENCODERS: Record<Platform, readonly Encoder[]> = {
  android: ['hw-h264', 'hw-hevc'],
  mac: ['x264', 'hw-h264', 'hw-hevc'],
};
const AUDIO_TARGETS: readonly ConvertTarget[] = ['m4a', 'mp3', 'opus', 'flac', 'wav'];
const VIDEO_TARGETS: readonly ConvertTarget[] = ['mp4', 'mov', 'mkv', 'webm'];

// Trust boundary: the spec arrives as JSON from the UI or the bridge, so every field is checked at runtime.
export function validateSpec(spec: unknown, info: MediaInfo, platform: Platform): string[] {
  if (typeof spec !== 'object' || spec === null) return ["This job type isn't supported yet."];
  const s = spec as Record<string, unknown>;
  const errors: string[] = [];
  if (s.inputId !== info.id) errors.push('The file changed since you picked it. Pick it again.');
  if (!(info.durationS > 0)) errors.push("The file's length couldn't be read. Pick another file.");
  const hasVideo = info.tracks.some(t => t.kind === 'video');
  const hasAudio = info.tracks.some(t => t.kind === 'audio');
  switch (s.tool) {
    case 'size': {
      if (!hasVideo) errors.push("This file has no video track, so it can't be compressed to a size. Use Extract audio instead.");
      const target = n(s.targetBytes);
      if (!(target >= MIN_TARGET_BYTES)) errors.push('Pick a size of at least 1 MB.');
      else if (target >= info.bytes) errors.push(`Pick a size below this file's size, which is ${(info.bytes / 1_000_000).toFixed(1)} MB.`);
      if (!ENCODERS[platform].includes(s.encoder as Encoder)) {
        errors.push(`This encoder isn't available on ${platform === 'android' ? 'this phone' : 'this Mac'}.`);
      }
      break;
    }
    case 'quality':
      if (!hasVideo) errors.push("This file has no video track, so there's nothing to shrink. Use Extract audio instead.");
      if (s.preset !== 'high' && s.preset !== 'medium' && s.preset !== 'small') errors.push('Pick High, Medium or Small.');
      break;
    case 'clip':
      if (!hasVideo) errors.push("This file has no video track, so there's nothing to clip.");
      if (!inSpan(s, info)) errors.push('Pick a start and an end inside the file, at least 0.1 s apart.');
      if (s.mode !== 'copy' && s.mode !== 'exact') errors.push('Pick Lossless or Exact.');
      break;
    case 'audio': {
      const track = info.tracks.find(t => t.index === s.trackIndex);
      if (!track || track.kind !== 'audio') errors.push('Pick an audio track in this file.');
      break;
    }
    case 'gif': {
      if (!hasVideo) errors.push("This file has no video track, so it can't make a GIF.");
      if (!inSpan(s, info)) errors.push('Pick a start and an end inside the file, at least 0.1 s apart.');
      else if (n(s.endS) - n(s.startS) > GIF_MAX_S) errors.push(`GIFs are capped at ${GIF_MAX_S} seconds. Shorten the range.`);
      if (!(n(s.width) >= 16 && n(s.width) <= 1920)) errors.push('Pick a width from 16 to 1920 px.');
      if (!(n(s.fps) >= 1 && n(s.fps) <= 30)) errors.push('Pick a frame rate from 1 to 30 fps.');
      if (s.targetBytes !== undefined && !(n(s.targetBytes) >= MIN_TARGET_BYTES)) errors.push('Pick a size of at least 1 MB.');
      break;
    }
    case 'convert': {
      const target = s.target;
      if (typeof target === 'string' && AUDIO_TARGETS.includes(target as ConvertTarget)) {
        if (!hasAudio) errors.push('This file has no audio to convert.');
        if (s.muted === true) errors.push('An audio format needs sound. Turn off Without sound or pick a video format.');
      } else if (typeof target === 'string' && VIDEO_TARGETS.includes(target as ConvertTarget)) {
        if (!hasVideo) errors.push("This file has no video, so it can't become a video.");
        if (s.videoCodec !== 'h264' && s.videoCodec !== 'hevc') errors.push('Pick H.264 or HEVC.');
      } else {
        errors.push('Pick a format to convert to.');
      }
      if (s.muted !== undefined && typeof s.muted !== 'boolean') errors.push('Without sound must be on or off.');
      break;
    }
    case 'frame': {
      if (!hasVideo) errors.push("This file has no video track, so there's no frame to save.");
      const t = n(s.timeS);
      if (!(t >= 0 && t < info.durationS)) errors.push('Pick a time inside the file.');
      if (s.format !== 'png' && s.format !== 'jpg') errors.push('Pick PNG or JPEG.');
      break;
    }
    case 'volume': {
      if (!hasAudio) errors.push('This file has no audio to change.');
      if (s.mode !== 'normalize' && s.mode !== 'gain') errors.push('Pick normalize or a gain in dB.');
      if (s.mode === 'gain' && !(Math.abs(n(s.gainDb)) <= GAIN_LIMIT_DB)) errors.push(`Pick a change from -${GAIN_LIMIT_DB} to +${GAIN_LIMIT_DB} dB.`);
      break;
    }
    case 'reverse': {
      const problem = reverseProblem(info);
      if (problem) errors.push(problem);
      if (typeof s.sound !== 'boolean') errors.push('Reverse the sound on or off.');
      break;
    }
    case 'stabilize':
      if (!hasVideo) errors.push("This file has no video track, so there's nothing to stabilize.");
      if (s.level !== 'minimum' && s.level !== 'recommended' && s.level !== 'most') errors.push('Pick Minimum cut, Recommended or Most stable.');
      break;
    default:
      errors.push("This job type isn't supported yet.");
  }
  return errors;
}

function n(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : NaN;
}

// The UI rounds times to 0.1 s, so an end up to 0.05 s past the length still counts.
function inSpan(s: Record<string, unknown>, info: MediaInfo): boolean {
  const start = n(s.startS);
  const end = n(s.endS);
  return start >= 0 && Math.round((end - start) * 10) >= 1 && end <= info.durationS + 0.05;
}
