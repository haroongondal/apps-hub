import type { PartRecord } from './dl-record.ts';

export const MIN_PART_BYTES = 1_048_576; // never plan a part smaller than 1 MiB
export const MIN_RESPLIT_BYTES = 1_048_576; // each half of a re-split keeps at least 1 MiB
export const HOST_CAP_TTL_MS = 1_800_000; // a host that refused remembers it for 30 minutes
export const MAX_ATTEMPTS = 5; // consecutive 429 or 503 answers to one part before the download fails (other failures use GIVE_UP_MS)
export const GIVE_UP_MS = 900_000; // a part that receives no byte for 15 minutes of failures and back-offs fails the download
export const STALL_MS = 30_000; // a connection that delivers no byte for 30 s is aborted and retried from its saved offset (time slept for the speed limit does not count)
export const HOST_MAX = 6; // connections Sieve opens to one host in total, across all downloads (Chrome's own HTTP/1.1 limit)

export type HostCaps = Record<string, { cap: number; until: number }>;

export function planParts(size: number, parts: number, minPart: number = MIN_PART_BYTES): PartRecord[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const wanted = Number.isFinite(parts) && parts >= 1 ? Math.floor(parts) : 1;
  const n = Math.max(1, Math.min(wanted, Math.floor(size / minPart)));
  const base = Math.floor(size / n);
  const extra = size - base * n;
  const out: PartRecord[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const len = base + (i < extra ? 1 : 0);
    out.push({ start, end: start + len - 1, done: 0 });
    start += len;
  }
  return out;
}

/** end - start + 1; Infinity when end is null. */
export function partLength(p: PartRecord): number {
  return p.end === null ? Infinity : p.end - p.start + 1;
}

/** partLength - done. */
export function remaining(p: PartRecord): number {
  return partLength(p) - p.done;
}

/** end !== null and done >= length. */
export function isPartComplete(p: PartRecord): boolean {
  return p.end !== null && p.done >= partLength(p);
}

/** Lowest index that is not complete and not active. */
export function nextToStart(parts: PartRecord[], active: readonly number[]): number | null {
  const i = parts.findIndex((p, idx) => !isPartComplete(p) && !active.includes(idx));
  return i < 0 ? null : i;
}

export function resplit(
  parts: PartRecord[],
  active: readonly number[],
  minHalf: number = MIN_RESPLIT_BYTES,
): { parts: PartRecord[]; added: number } | null {
  let best = -1;
  for (const i of [...active].sort((a, b) => a - b)) {
    const p = parts[i];
    if (!p || p.end === null) continue;
    if (best < 0 || remaining(p) > remaining(parts[best])) best = i;
  }
  if (best < 0) return null;
  const p = parts[best];
  const rem = remaining(p);
  if (rem < 2 * minHalf) return null;
  const newStart = p.start + p.done + Math.ceil(rem / 2);
  const next = parts.map((q) => ({ ...q }));
  next[best].end = newStart - 1;
  next.push({ start: newStart, end: p.end, done: 0 });
  return { parts: next, added: parts.length };
}

/** Lowercase hostname without port; '' when the URL does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function capFor(caps: HostCaps, host: string, wanted: number, now: number): number {
  const c = caps[host];
  return c && c.until > now ? Math.min(wanted, c.cap) : wanted;
}

export function onRefused(caps: HostCaps, host: string, activeConnections: number, now: number): HostCaps {
  const cap = capFor(caps, host, Math.max(1, Math.floor(activeConnections / 2)), now);
  return { ...caps, [host]: { cap: Math.max(1, cap), until: now + HOST_CAP_TTL_MS } };
}

export function backoffMs(attempt: number, retryAfterMs?: number | null): number {
  const a = Number.isFinite(attempt) ? Math.max(1, attempt) : 1;
  const base = Math.min(2000 * 2 ** (a - 1), 30000);
  return Math.min(60000, Math.max(base, Number.isFinite(retryAfterMs) ? (retryAfterMs as number) : 0));
}

export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  if (!/^[A-Za-z]{3}/.test(v)) return null; // an HTTP date starts with the day name; Date.parse alone takes '1.5' or '2026-11-10'
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}
