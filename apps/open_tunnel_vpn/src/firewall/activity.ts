/**
 * Activity log helpers. Pure TypeScript, Hermes-safe.
 */
import type { ActivityEntry } from '../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

export const UNKNOWN_APP_LABEL = 'Unknown app';

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
