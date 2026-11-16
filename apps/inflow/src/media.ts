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

/** What the list row shows for an item's files: from the count alone, so no row asks the database. */
export const mediaCountLabel = (count: number): string => (count === 1 ? 'Media' : `${count} media files`);

export function mediaStatsLabel(s: MediaStats): string {
  if (s.saved === 0 && s.unreadable === 0) {
    if (s.tooBig === 0) return 'No media saved yet';
    return `No media saved yet. ${s.tooBig === 1 ? '1 file was' : `${s.tooBig} files were`} too big.`;
  }
  const saved = `${s.saved} ${s.saved === 1 ? 'file' : 'files'} saved (${sizeLabel(s.bytes)}).`;
  const problems = [s.unreadable > 0 && `${s.unreadable} could not be read`, s.tooBig > 0 && `${s.tooBig} too big`].filter(Boolean);
  return problems.length > 0 ? `${saved} ${problems.join(', ')}.` : saved;
}
