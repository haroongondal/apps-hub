import type { Codec, MediaInfo } from './types.ts';

// MediaMuxer's MP4 column and WebM column (RESEARCH §4.3, AOSP MediaMuxer.java). A copy needs every kept track in one column.
const MP4: readonly Codec[] = ['h264', 'hevc', 'av1', 'mpeg4', 'aac'];
const WEBM: readonly Codec[] = ['vp8', 'vp9', 'vorbis', 'opus'];

export function androidContainerFor(info: MediaInfo): 'mp4' | 'webm' | undefined {
  const kept = info.tracks.filter(t => t.kind === 'video' || t.kind === 'audio').map(t => t.codec);
  if (kept.every(c => MP4.includes(c))) return 'mp4';
  if (kept.every(c => WEBM.includes(c))) return 'webm';
  return undefined;
}
export const canRemux = (info: MediaInfo): boolean => androidContainerFor(info) !== undefined;
