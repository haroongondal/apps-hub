import type { JobSpec, MediaInfo, QualityName } from '@apps-hub/media-core';

import type { ToolKey } from './tools.ts';

// Everything a tool screen lets a person choose. The same options apply to every picked file (PRD FR-9).
export interface Options {
  targetBytes: number; how: 'size' | 'quality'; quality: QualityName; smaller: boolean;
  startS?: number; endS?: number; cut: 'copy' | 'exact';
  skippedSounds: Record<string, number[]>; // per file id: sound tracks the person turned off (default: all are saved)
  gifWidth: number; gifFps: number; gifMb: string;
  kind: 'video' | 'sound'; muted: boolean; format: 'png' | 'jpg';
  louder: 'even' | '-12' | '-6' | '6' | '12'; withSound: boolean; level: 'minimum' | 'recommended' | 'most';
}

export const soundTracksOf = (f: MediaInfo) => f.tracks.filter(t => t.kind === 'audio').map(t => t.index);

export function specsFor(tool: ToolKey, f: MediaInfo, o: Options): JobSpec[] {
  switch (tool) {
    case 'smaller': return [o.how === 'size'
      ? { tool: 'size', inputId: f.id, targetBytes: o.targetBytes, encoder: o.smaller ? 'hw-hevc' : 'hw-h264' }
      : { tool: 'quality', inputId: f.id, preset: o.quality }];
    case 'trim': return [{ tool: 'clip', inputId: f.id, startS: o.startS ?? -1, endS: o.endS ?? -1, mode: o.cut }];
    case 'sound': return soundTracksOf(f).filter(i => !o.skippedSounds[f.id]?.includes(i)).map(i => ({ tool: 'audio' as const, inputId: f.id, trackIndex: i }));
    case 'gif': return [{ tool: 'gif', inputId: f.id, startS: o.startS ?? -1, endS: o.endS ?? -1, width: o.gifWidth, fps: o.gifFps, ...(o.gifMb ? { targetBytes: Math.round(Number(o.gifMb) * 1_000_000) } : {}) }];
    // "Remove the sound" only exists for a video; a sound-only file must never carry it over
    case 'format': return [{ tool: 'convert', inputId: f.id, target: o.kind === 'sound' ? 'm4a' : 'mp4', videoCodec: o.smaller ? 'hevc' : 'h264', muted: o.kind === 'video' && o.muted }];
    case 'picture': return [{ tool: 'frame', inputId: f.id, timeS: o.startS ?? -1, format: o.format }];
    case 'volume': return [o.louder === 'even' ? { tool: 'volume', inputId: f.id, mode: 'normalize', gainDb: 0 } : { tool: 'volume', inputId: f.id, mode: 'gain', gainDb: Number(o.louder) }];
    case 'backwards': return [{ tool: 'reverse', inputId: f.id, sound: o.withSound }];
    case 'steady': return [{ tool: 'stabilize', inputId: f.id, level: o.level }];
  }
}
