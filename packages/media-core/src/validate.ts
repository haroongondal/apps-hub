import type { Encoder, MediaInfo, Platform } from './types.ts';

// The only job type in Phase 1. Phase 2 adds the other tools to this union.
export interface SizeSpec { tool: 'size'; inputId: string; targetBytes: number; encoder: Encoder }
export type JobSpec = SizeSpec;

const MIN_TARGET_BYTES = 1_000_000;
const ENCODERS: Record<Platform, readonly Encoder[]> = {
  android: ['hw-h264', 'hw-hevc'],
  mac: ['x264', 'hw-h264', 'hw-hevc'],
};

// Trust boundary: the spec arrives as JSON from the UI or the bridge, so every field is checked at runtime.
export function validateSpec(spec: unknown, info: MediaInfo, platform: Platform): string[] {
  if (!isSizeSpec(spec)) return ["This job type isn't supported yet."];
  const errors: string[] = [];
  if (spec.inputId !== info.id) errors.push('The file changed since you picked it. Pick it again.');
  if (!info.tracks.some(t => t.kind === 'video')) {
    errors.push("This file has no video track, so it can't be compressed to a size. Use Extract audio instead.");
  }
  if (!(info.durationS > 0)) errors.push("The file's length couldn't be read. Pick another file.");
  if (!(spec.targetBytes >= MIN_TARGET_BYTES)) {
    errors.push('Pick a size of at least 1 MB.');
  } else if (spec.targetBytes >= info.bytes) {
    errors.push(`Pick a size below this file's size, which is ${(info.bytes / 1_000_000).toFixed(1)} MB.`);
  }
  if (!ENCODERS[platform].includes(spec.encoder)) {
    errors.push(`This encoder isn't available on ${platform === 'android' ? 'this phone' : 'this Mac'}.`);
  }
  return errors;
}

function isSizeSpec(x: unknown): x is SizeSpec {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return s.tool === 'size' && typeof s.inputId === 'string' && typeof s.targetBytes === 'number' && typeof s.encoder === 'string';
}
