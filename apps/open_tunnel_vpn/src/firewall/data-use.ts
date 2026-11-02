/**
 * Data-use helpers. Pure TypeScript, Hermes-safe.
 */
import type { AppRule, DataUseRow, FirewallRuleKind } from '../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

/** Largest mobile use first; equal rows keep their order. Does not mutate. */
export function sortByMobile<T extends DataUseRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.cellBytes - a.cellBytes);
}

export function totalBytes(row: DataUseRow): number {
  return row.wifiBytes + row.cellBytes;
}

export interface AppUseRow extends DataUseRow {
  pkg: string;
  label: string;
  rule: FirewallRuleKind;
}

/** Every installed app with its use (zero when none) and rule: most mobile data first, then by name. */
export function joinAppUse(apps: AppRule[], use: DataUseRow[]): AppUseRow[] {
  const byUid = new Map(use.map((row) => [row.uid, row]));
  const rows = apps.map((app) => ({
    uid: app.uid,
    pkg: app.pkg,
    label: app.label,
    rule: app.rule,
    wifiBytes: byUid.get(app.uid)?.wifiBytes ?? 0,
    cellBytes: byUid.get(app.uid)?.cellBytes ?? 0,
  }));
  return sortByMobile(rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })));
}
