import type { ReconciledDevice } from './device-repository.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

export interface PersonStatus {
  person: string;
  home: boolean;
  lastSeenAt: number;
  deviceIds: number[];
}

const tagOf = (d: ReconciledDevice): string => (d.person ?? '').trim();
const nameKey = (n: string | null): string => (n ?? '').trim().toLowerCase();

const matchKey = (n: string | null): string => (isGenericDeviceName(n ?? '') ? '' : nameKey(n));

/** One entry per person (case-insensitive tag); home when any of their devices answered this scan. */
export function peopleStatus(devices: readonly ReconciledDevice[]): PersonStatus[] {
  const byKey = new Map<string, PersonStatus>();
  for (const d of devices) {
    const tag = tagOf(d);
    if (!tag) continue;
    const key = tag.toLowerCase();
    let entry = byKey.get(key);
    if (!entry) {
      entry = { person: tag, home: false, lastSeenAt: 0, deviceIds: [] };
      byKey.set(key, entry);
    }
    entry.home ||= d.seenThisScan;
    entry.lastSeenAt = Math.max(entry.lastSeenAt, d.lastSeenAt);
    if (d.id !== null) entry.deviceIds.push(d.id);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(b.home) - Number(a.home) ||
      (a.person.toLowerCase() < b.person.toLowerCase() ? -1 : a.person.toLowerCase() > b.person.toLowerCase() ? 1 : 0),
  );
}

const DEVICE_WORDS = new Set([
  'android', 'iphone', 'ipad', 'ipod', 'galaxy', 'pixel', 'redmi', 'oneplus', 'xiaomi', 'huawei',
  'samsung', 'phone', 'tablet', 'localhost', 'unknown', 'device', 'mi', 'note', 'watch',
]);

/**
 * True when a name is only device-type words and model codes ("iPhone", "Galaxy-S21", "Pixel 7",
 * "localhost"): many phones share it, so it says nothing about whose phone it is. "iPhone 12" is
 * generic; "Saras-iPhone" is not. A blank name is generic (nothing to match on).
 */
export function isGenericDeviceName(name: string): boolean {
  const tokens = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.every((t) => {
    if (DEVICE_WORDS.has(t)) return true;
    const word = /^(\p{L}+)\d{1,4}$/u.exec(t)?.[1]; // "note10", "pixel7"
    if (word && DEVICE_WORDS.has(word)) return true;
    return t.length <= 4 && /\d/.test(t) && (t.match(/\p{L}/gu) ?? []).length <= 2; // "s21", "8t", "12"
  });
}

/**
 * A phone that came back with a new identity key (MAC randomisation) keeps its owner:
 * the tag moves from the stale row to the one seen untagged row with the same
 * non-empty hostname or mdnsName. A generic name ({@link isGenericDeviceName}) never matches.
 * Returns only the rows that changed.
 */
export function carryPersonTags(devices: readonly ReconciledDevice[]): ReconciledDevice[] {
  const candidates = devices
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.seenThisScan && !tagOf(d));
  const changed = new Map<number, ReconciledDevice>();
  devices.forEach((old, oldIndex) => {
    if (old.seenThisScan || !tagOf(old)) return;
    const host = matchKey(old.hostname);
    const mdns = matchKey(old.mdnsName);
    const matches = candidates.filter(
      ({ d }) =>
        (host !== '' && nameKey(d.hostname) === host) || (mdns !== '' && nameKey(d.mdnsName) === mdns),
    );
    if (matches.length !== 1 || changed.has(matches[0].i)) return;
    changed.set(matches[0].i, { ...matches[0].d, person: old.person });
    changed.set(oldIndex, { ...old, person: null });
  });
  return [...changed.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d);
}

/** Phones sleep their radios but still answer or refuse on one of these. */
export const HOME_PROBE_PORTS = [62078, 80, 443, 22, 445, 5353, 8080] as const;
export const HOME_PROBE_TIMEOUT_MS = 800;

export async function probeHome(
  binding: Pick<NetLensNativeBinding, 'measureTcpHandshake'>,
  ip: string,
): Promise<boolean> {
  for (const port of HOME_PROBE_PORTS) {
    try {
      const { outcome } = await binding.measureTcpHandshake(ip, port, HOME_PROBE_TIMEOUT_MS);
      if (outcome === 'open' || outcome === 'refused') return true;
    } catch {
      // a failed bridge call on one port is just "not reachable" there
    }
  }
  return false;
}
