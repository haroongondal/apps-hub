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
export function carryPersonTags(
  devices: readonly ReconciledDevice[],
  serviceNamesByIp?: ReadonlyMap<string, readonly string[]>,
): ReconciledDevice[] {
  const changed = new Map<number, ReconciledDevice>();
  for (const c of carryMatches(devices, serviceNamesByIp).filter((m) => !m.suggest)) {
    changed.set(c.to, { ...devices[c.to], person: devices[c.from].person });
    changed.set(c.from, { ...devices[c.from], person: null });
  }
  return [...changed.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d);
}

export interface TagCarry {
  person: string;
  from: ReconciledDevice;
  device: ReconciledDevice;
  reason: string;
}

export function personTagCarries(
  devices: readonly ReconciledDevice[],
  serviceNamesByIp?: ReadonlyMap<string, readonly string[]>,
): TagCarry[] {
  return tagMoves(devices, serviceNamesByIp, false);
}

/** Moves the owner should confirm: a row that only calls itself "<person>'s …" may be their laptop or a guest's phone. */
export function personTagSuggestions(
  devices: readonly ReconciledDevice[],
  serviceNamesByIp?: ReadonlyMap<string, readonly string[]>,
): TagCarry[] {
  return tagMoves(devices, serviceNamesByIp, true);
}

function tagMoves(
  devices: readonly ReconciledDevice[],
  serviceNamesByIp: ReadonlyMap<string, readonly string[]> | undefined,
  suggest: boolean,
): TagCarry[] {
  return carryMatches(devices, serviceNamesByIp)
    .filter((c) => c.suggest === suggest)
    .map((c) => ({
      person: tagOf(devices[c.from]),
      from: { ...devices[c.from], person: null },
      device: { ...devices[c.to], person: devices[c.from].person },
      reason: c.reason,
    }));
}

export function ownerOfName(name: string | null): string | null {
  const owner = /^(.{1,32}?)['’]s\s+\S/u.exec((name ?? '').trim())?.[1].trim() ?? '';
  return /\p{L}/u.test(owner) && !isGenericDeviceName(owner) ? owner : null;
}

// Signals in order; a later one runs only when the one before matched no row at all, so the old
// name match never changes. Bonjour names ("Haroon's iPhone") come from this scan, cleaned, by IP.
function carryMatches(
  devices: readonly ReconciledDevice[],
  serviceNamesByIp: ReadonlyMap<string, readonly string[]> = new Map(),
): { from: number; to: number; reason: string; suggest: boolean }[] {
  const candidates = devices
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.seenThisScan && !tagOf(d));
  const services = (d: ReconciledDevice): readonly string[] => serviceNamesByIp.get(d.lastIp) ?? [];
  const used = new Set<number>();
  const found: { from: number; to: number; reason: string; suggest: boolean }[] = [];
  devices.forEach((old, from) => {
    if (old.seenThisScan || !tagOf(old)) return;
    const host = matchKey(old.hostname);
    const mdns = matchKey(old.mdnsName);
    const person = tagOf(old).toLowerCase();
    const sameName = (n: string | null): boolean => matchKey(n) !== '' && (matchKey(n) === host || matchKey(n) === mdns);
    const steps: ((d: ReconciledDevice) => string | null)[] = [
      (d) =>
        host !== '' && nameKey(d.hostname) === host
          ? `Same name on the network, ${d.hostname}`
          : mdns !== '' && nameKey(d.mdnsName) === mdns
            ? `Same name on the network, ${d.mdnsName}`
            : null,
      (d) => {
        const name = services(d).find(sameName);
        return name ? `It announces the same name, ${name}` : null;
      },
      (d) => {
        const name = [d.hostname, d.mdnsName, ...services(d)].find((n) => ownerOfName(n)?.toLowerCase() === person);
        return name ? `It calls itself ${name}` : null;
      },
    ];
    for (const [n, step] of steps.entries()) {
      const matches = candidates.flatMap(({ d, i }) => {
        const reason = step(d);
        return reason === null ? [] : [{ i, reason }];
      });
      if (matches.length === 0) continue;
      if (matches.length === 1 && !used.has(matches[0].i)) {
        // The owner word is only a suggestion: it never moves the tag (and so never takes the row) by itself.
        const suggest = n === steps.length - 1;
        if (!suggest) used.add(matches[0].i);
        found.push({ from, to: matches[0].i, reason: matches[0].reason, suggest });
      }
      return;
    }
  });
  return found;
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
