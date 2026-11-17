import type { CleanupGroup, CleanupKind, RemovedPhoto } from 'design-media';
import { formatMb } from '@apps-hub/media-core';

export type Ticks = Record<string, boolean>; // uri -> ticked

const KIND_NAMES: Record<CleanupKind, string> = {
  blurry: 'Blurry', copies: 'Copies', lookalikes: 'Look-alikes', screenshots: 'Screenshots', dark: 'Too dark or too bright',
};
export const kindName = (kind: CleanupKind): string => KIND_NAMES[kind];

export const sizeText = (bytes: number): string => (bytes < 1e9 ? formatMb(bytes) : `${(bytes / 1e9).toFixed(1)} GB`);
export const photosText = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'photo' : 'photos'}`;

export interface KindRow { kind: CleanupKind; title: string; subtitle: string; label: string; count: number; bytes: number }
export function kindRows(groups: CleanupGroup[]): KindRow[] {
  const byKind = new Map<CleanupKind, { count: number; bytes: number }>();
  for (const g of groups) {
    const t = byKind.get(g.kind) ?? { count: 0, bytes: 0 };
    t.count += g.photos.filter((p) => !p.best).length;
    t.bytes += g.bytes;
    byKind.set(g.kind, t);
  }
  return [...byKind].map(([kind, { count, bytes }]) => {
    const subtitle = `${photosText(count)} · ${sizeText(bytes)}`;
    return { kind, title: kindName(kind), subtitle, label: `${kindName(kind)} · ${subtitle}`, count, bytes };
  });
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export function lastScanText(lastScan: number, now: number): string {
  if (lastScan <= 0) return 'Not checked yet';
  const min = Math.floor((now - lastScan) / 60_000);
  if (min < 1) return 'Checked just now';
  if (min < 60) return `Checked ${plural(min, 'minute')} ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `Checked ${plural(hours, 'hour')} ago`;
  return `Checked ${plural(Math.floor(hours / 24), 'day')} ago`;
}

const photosIn = (groups: CleanupGroup[]) => groups.flatMap((g) => g.photos);

export function initialTicks(groups: CleanupGroup[]): Ticks {
  return Object.fromEntries(photosIn(groups).map((p) => [p.uri, p.ticked]));
}
// owner's choices stay for photos still shown; photos new to the list take the engine default
export function mergeTicks(prev: Ticks, groups: CleanupGroup[]): Ticks {
  return Object.fromEntries(photosIn(groups).map((p) => [p.uri, prev[p.uri] ?? p.ticked]));
}
export function tickAll(groups: CleanupGroup[], on: boolean): Ticks {
  return Object.fromEntries(photosIn(groups).map((p) => [p.uri, on && !p.best]));
}

export function selection(groups: CleanupGroup[], ticks: Ticks): { uris: string[]; count: number; bytes: number } {
  const seen = new Map<string, number>();
  for (const p of photosIn(groups)) if (ticks[p.uri] && !seen.has(p.uri)) seen.set(p.uri, p.bytes);
  return { uris: [...seen.keys()], count: seen.size, bytes: [...seen.values()].reduce((a, b) => a + b, 0) };
}
export const deleteLabel = (count: number, bytes: number): string =>
  count === 0 ? 'Delete' : `Delete ${photosText(count)} (${sizeText(bytes)})`;

export const wholeSetTicked = (groups: CleanupGroup[], ticks: Ticks): boolean =>
  groups.some((g) => (g.kind === 'copies' || g.kind === 'lookalikes') && g.photos.length >= 2 && g.photos.every((p) => ticks[p.uri]));

const NOT_NOTED = " Clean up couldn't add them to Recently removed. Undo now if you need them back, or look in your Gallery app's trash.";
export const doneText = (moved: number, noted: boolean): string =>
  `${photosText(moved)} moved to trash. You can restore ${moved === 1 ? 'it' : 'them'} for 30 days.${noted ? '' : NOT_NOTED}`;
export const restoredText = (n: number): string => `${photosText(n)} ${n === 1 ? 'is' : 'are'} back in your gallery.`;

export function removedText(p: RemovedPhoto, now: number): string {
  const days = Math.floor((p.expiresAt - now) / 86_400_000);
  return `${formatMb(p.bytes)} · ${days < 1 ? 'Less than a day left' : `${plural(days, 'day')} left`}`;
}
export const hiddenText = (kind: CleanupKind): string => `Hidden from ${kindName(kind)}.`;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const blurAt = (fraction: number, blur: { min: number; max: number }): number => blur.min + clamp01(fraction) * (blur.max - blur.min);
export const blurFraction = (threshold: number, blur: { min: number; max: number }): number =>
  blur.max === blur.min ? 0 : clamp01((threshold - blur.min) / (blur.max - blur.min));
