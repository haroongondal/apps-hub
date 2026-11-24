import type { Clip } from 'clipboard-core';

const HIDDEN: Record<string, string> = { secret: 'Password · hidden', code: 'Code · hidden' };

export function clipTitle(clip: Clip): string {
  if (HIDDEN[clip.kind]) return HIDDEN[clip.kind];
  if (clip.kind === 'image') return 'Image';
  if (clip.kind === 'file') return `File · ${clip.mime ?? 'unknown type'}`;
  return clip.text ?? '';
}

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export function clipSubtitle(clip: Clip, now: number): string {
  const parts = [ago(clip.at, now)];
  if (clip.pinned) parts.unshift('Pinned');
  if (clip.source) parts.push(clip.source);
  if (clip.via === 'app') parts.push('saved when you opened Clipboard');
  return parts.join(' · ');
}

export const KEEP_CHOICES = [7, 30, 90, 365] as const;

export function keepLabel(days: number): string {
  return days === 365 ? '1 year' : `${days} days`;
}
