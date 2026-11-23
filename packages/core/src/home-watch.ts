// Background checks run natively (Android WorkManager) without JS, so the app hands native a
// snapshot of its device list after each scan on the home network; iOS answers { supported: false }.
import type { ReconciledDevice } from './device-repository.ts';
import type { KnownHost } from './new-devices.ts';

export const NEW_DEVICE_HOURS = [3, 6, 12, 24] as const;
export const DEFAULT_NEW_DEVICE_HOURS = 6;
const MAX_PEOPLE = 16;
const MAX_IPS_PER_PERSON = 4;
const MAX_KNOWN = 512;

export interface HomeNetworkRef {
  networkId: string;
  gatewayIp: string;
  label: string;
}

export interface HomeWatchSettings {
  whoIsHome: boolean;
  newDevices: boolean;
  newDeviceHours: number;
  share: boolean;
  home: HomeNetworkRef | null;
}

export const DEFAULT_HOME_WATCH_SETTINGS: HomeWatchSettings = {
  whoIsHome: false,
  newDevices: false,
  newDeviceHours: DEFAULT_NEW_DEVICE_HOURS,
  share: false,
  home: null,
};

export interface HomeWatchPerson {
  label: string;
  present: boolean;
  lastSeenAt: number;
}

export interface HomeWatchNewDevice {
  ip: string;
  firstSeenAt: number;
  label: string;
  acknowledged: boolean;
}

export type HomeWatchStatus =
  | { supported: false }
  | {
      supported: true;
      settings: HomeWatchSettings;
      people: HomeWatchPerson[];
      newDevices: HomeWatchNewDevice[];
    };

export interface SnapshotPerson {
  label: string;
  ips: string[];
  seenNow: boolean;
  lastSeenAt: number;
}

export interface HomeWatchSnapshot {
  people: SnapshotPerson[];
  known: KnownHost[];
}

export interface HomeWatchBinding {
  getHomeWatch(): Promise<HomeWatchStatus>;
  setHomeWatch(settings: HomeWatchSettings, snapshot: HomeWatchSnapshot | null): Promise<HomeWatchStatus>;
  markDeviceMine(ip: string): Promise<HomeWatchStatus>;
}

export function homeWatchSnapshot(devices: readonly ReconciledDevice[]): HomeWatchSnapshot {
  const newestFirst = [...devices].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const people = new Map<string, SnapshotPerson>();
  const known = new Map<string, KnownHost>();
  for (const d of newestFirst) {
    const tag = (d.person ?? '').trim();
    const k = known.get(d.lastIp);
    known.set(d.lastIp, {
      ip: d.lastIp,
      lastSeenAt: Math.max(k?.lastSeenAt ?? 0, d.lastSeenAt),
      tagged: (k?.tagged ?? false) || tag !== '' || d.isTrusted,
    });
    if (!tag) continue;
    const p = people.get(tag.toLowerCase());
    if (!p) {
      if (people.size < MAX_PEOPLE) {
        people.set(tag.toLowerCase(), { label: tag, ips: [d.lastIp], seenNow: d.seenThisScan, lastSeenAt: d.lastSeenAt });
      }
      continue;
    }
    if (!p.ips.includes(d.lastIp) && p.ips.length < MAX_IPS_PER_PERSON) p.ips.push(d.lastIp);
    p.seenNow ||= d.seenThisScan;
  }
  return { people: [...people.values()], known: [...known.values()].slice(0, MAX_KNOWN) };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : [];

export function parseHomeWatchStatus(raw: unknown): HomeWatchStatus {
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).supported !== true) {
    return { supported: false };
  }
  const r = raw as Record<string, unknown>;
  const s = (typeof r.settings === 'object' && r.settings !== null ? r.settings : {}) as Record<string, unknown>;
  const h = (typeof s.home === 'object' && s.home !== null ? s.home : null) as Record<string, unknown> | null;
  const hours = num(s.newDeviceHours);
  const home =
    h && str(h.networkId) && str(h.gatewayIp)
      ? { networkId: str(h.networkId)!, gatewayIp: str(h.gatewayIp)!, label: str(h.label) ?? '' }
      : null;
  return {
    supported: true,
    settings: {
      whoIsHome: s.whoIsHome === true,
      newDevices: s.newDevices === true,
      newDeviceHours: (NEW_DEVICE_HOURS as readonly number[]).includes(hours) ? hours : DEFAULT_NEW_DEVICE_HOURS,
      share: s.share === true,
      home,
    },
    people: list(r.people).flatMap((p) =>
      str(p.label) ? [{ label: str(p.label)!, present: p.present === true, lastSeenAt: num(p.lastSeenAt) }] : [],
    ),
    newDevices: list(r.newDevices).flatMap((d) =>
      str(d.ip)
        ? [{ ip: str(d.ip)!, firstSeenAt: num(d.firstSeenAt), label: str(d.label) ?? 'Unknown device', acknowledged: d.acknowledged === true }]
        : [],
    ),
  };
}
