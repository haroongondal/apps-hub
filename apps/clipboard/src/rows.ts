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
  if (clip.source) parts.push(clip.source);
  parts.push(clip.via === 'app' ? 'saved on open' : `noticed in ${clip.grabMs ?? '?'} ms`);
  return parts.join(' · ');
}
