// What a person reads: sizes in MB, times as m:ss (PRD FR-13).
export const formatMb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(bytes >= 100_000_000 ? 0 : 1)} MB`;

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

import type { Refusal } from './types.ts';

// The plain sentence for a refusal (PRD FR-3, FR-13): what happened, and what to do.
export function refusalText(r: Refusal, targetBytes?: number): string {
  const size = targetBytes ? `${Number((targetBytes / 1_000_000).toFixed(1))} MB` : 'that size';
  if (r.reason === 'too-long') {
    const holds = r.maxDurationS >= 90 ? `${Math.floor(r.maxDurationS / 60)} minutes` : `${Math.max(1, Math.round(r.maxDurationS))} seconds`;
    return `Couldn't fit under ${size}. This video can hold about ${holds} at the lowest quality. Trim it first, or pick a bigger size.`;
  }
  if (r.reason === 'gave-up') return r.detail ?? `Couldn't fit under ${size}. Pick a bigger size.`;
  if (r.reason === 'no-video') return "This file has no picture, so this tool can't use it.";
  return r.detail ?? "This file can't be used with this tool.";
}
