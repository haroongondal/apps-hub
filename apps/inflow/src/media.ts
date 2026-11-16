import type { MediaInfo, MediaStats } from 'inflow-core';

export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const KINDS: Record<MediaInfo['kind'], string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
  other: 'File',
};
export const mediaKindLabel = (kind: MediaInfo['kind']): string => KINDS[kind] ?? 'File';

export function mediaStatsLabel(s: MediaStats): string {
  if (s.saved === 0 && s.unreadable === 0) return 'No media saved yet';
  const saved = `${s.saved} ${s.saved === 1 ? 'file' : 'files'} saved (${sizeLabel(s.bytes)}).`;
  return s.unreadable > 0 ? `${saved} ${s.unreadable} could not be read.` : saved;
}
