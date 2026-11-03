/**
 * Activity log helpers. Pure TypeScript, Hermes-safe.
 */
import type { ActivityEntry } from '../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';
import { formatBytes } from '../ui/format.ts';

export const UNKNOWN_APP_LABEL = 'Unknown app';
export const NO_DOMAIN_LABEL = 'No domain seen';

/** The log stores the machine string `unknown` for an unresolved owner (UID -1). */
export function appLabel(pkg: string): string {
  return pkg === 'unknown' || pkg === UNKNOWN_APP_LABEL ? UNKNOWN_APP_LABEL : pkg;
}

/** `blocked` comes from the entry's own verdict only, never from a rule. */
export function filterActivity(
  entries: ActivityEntry[],
  f: { uid?: number; blockedOnly: boolean },
): ActivityEntry[] {
  return entries.filter(
    (e) => (f.uid === undefined || e.uid === f.uid) && (!f.blockedOnly || e.verdict === 'blocked'),
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

function clock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The two lines of one log row. A missing domain says so; the address always shows. */
export function activityRow(entry: ActivityEntry, appName?: string): { title: string; subtitle: string } {
  const host = entry.dst.includes(':') ? `[${entry.dst}]` : entry.dst;
  const where = `${entry.domain ?? NO_DOMAIN_LABEL} \u00b7 ${host}:${entry.dstPort} \u00b7 ${entry.proto.toUpperCase()}`;
  const moved = `${clock(entry.timestampMs)} \u00b7 Sent ${formatBytes(entry.bytesOut)} \u00b7 Received ${formatBytes(entry.bytesIn)}`;
  return { title: appName ?? appLabel(entry.pkg), subtitle: `${where}\n${moved}` };
}
