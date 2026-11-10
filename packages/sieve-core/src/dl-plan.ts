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
  throw new Error('not implemented');
}
/** end - start + 1; Infinity when end is null. */
export function partLength(p: PartRecord): number {
  throw new Error('not implemented');
}
/** partLength - done. */
export function remaining(p: PartRecord): number {
  throw new Error('not implemented');
}
/** end !== null and done >= length. */
export function isPartComplete(p: PartRecord): boolean {
  throw new Error('not implemented');
}
/** Lowest index that is not complete and not active. */
export function nextToStart(parts: PartRecord[], active: readonly number[]): number | null {
  throw new Error('not implemented');
}
export function resplit(
  parts: PartRecord[],
  active: readonly number[],
  minHalf: number = MIN_RESPLIT_BYTES,
): { parts: PartRecord[]; added: number } | null {
  throw new Error('not implemented');
}
/** Lowercase hostname without port; '' when the URL does not parse. */
export function hostOf(url: string): string {
  throw new Error('not implemented');
}
export function capFor(caps: HostCaps, host: string, wanted: number, now: number): number {
  throw new Error('not implemented');
}
export function onRefused(caps: HostCaps, host: string, activeConnections: number, now: number): HostCaps {
  throw new Error('not implemented');
}
export function backoffMs(attempt: number, retryAfterMs?: number | null): number {
  throw new Error('not implemented');
}
export function parseRetryAfter(value: string | null, now: number): number | null {
  throw new Error('not implemented');
}
