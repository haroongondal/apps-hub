/**
 * Data-use helpers. Pure TypeScript, Hermes-safe.
 */
import type { DataUseRow } from '../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

/** Largest mobile use first; equal rows keep their order. Does not mutate. */
export function sortByMobile(rows: DataUseRow[]): DataUseRow[] {
  return [...rows].sort((a, b) => b.cellBytes - a.cellBytes);
}

export function totalBytes(row: DataUseRow): number {
  return row.wifiBytes + row.cellBytes;
}
