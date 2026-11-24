// Background checks run natively (Android WorkManager) without JS, so the app hands native a
// snapshot of its device list after each scan on the home network; iOS answers { supported: false }.
import type { ReconciledDevice } from './device-repository.ts';
import { MAX_XML } from './igd.ts';
import { httpRequest, parseHttpUrl } from './lan-http.ts';
import type { InterfaceInfo } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';
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
  /** The router's own UPnP ID and the description URL it came from; the background checks run only when both still match. */
  routerId: string;
  routerUrl: string;
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
  /** Refreshes the stored home's label and URL and the device snapshot; native keeps its own switches and refuses a different home. */
  syncHome(home: HomeNetworkRef, snapshot: HomeWatchSnapshot): Promise<HomeWatchStatus>;
  markDeviceMine(ip: string): Promise<HomeWatchStatus>;
}

/** The same calls, one at a time in the order they were made (native runs each on its own thread and could swap two). */
export interface OrderedHomeWatch {
  /** A status is null when a newer call was made after this one: that call's answer is the fresher one. */
  getHomeWatch(): Promise<HomeWatchStatus | null>;
  setHomeWatch(settings: HomeWatchSettings, snapshot: HomeWatchSnapshot | null): Promise<HomeWatchStatus | null>;
  syncHome(home: HomeNetworkRef, snapshot: HomeWatchSnapshot): Promise<HomeWatchStatus | null>;
  markDeviceMine(ip: string): Promise<HomeWatchStatus | null>;
}

export function orderHomeWatch(binding: HomeWatchBinding): OrderedHomeWatch {
  let tail: Promise<unknown> = Promise.resolve();
  let issued = 0;
  const run = (call: () => Promise<HomeWatchStatus>): Promise<HomeWatchStatus | null> => {
    const seq = ++issued;
    const result = tail.then(call);
    tail = result.catch(() => undefined);
    return result.then((status) => (seq === issued ? status : null));
  };
  return {
    getHomeWatch: () => run(() => binding.getHomeWatch()),
    setHomeWatch: (settings, snapshot) => run(() => binding.setHomeWatch(settings, snapshot)),
    syncHome: (home, snapshot) => run(() => binding.syncHome(home, snapshot)),
    markDeviceMine: (ip) => run(() => binding.markDeviceMine(ip)),
  };
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

/** The home the post-scan sync may refresh: label and description URL only. It never carries share or the other switches. */
export function postScanSyncHome(
  latest: HomeWatchSettings | null,
  router: { routerId: string; routerUrl: string },
  networkName: string | null,
): HomeNetworkRef | null {
  const saved = latest?.home;
  if (!latest || !saved || !(latest.whoIsHome || latest.newDevices)) return null;
  // Another router at the same address is not home.
  if (router.routerId !== saved.routerId) return null;
  return { ...saved, label: networkName ?? saved.label, routerUrl: router.routerUrl };
}

const UDN = /<UDN>\s*(uuid:[^<>\s]{1,128})\s*<\/UDN>/i;
const MAX_ROUTER_URLS = 8;

/** The first UDN of a device description, the router itself. Twin of HomeRouter.routerId (Kotlin). */
export function routerIdOf(description: string): string | null {
  return UDN.exec(description)?.[1] ?? null;
}

/** The gateway's own ID from a description URL it announced; null when the router gives none. */
export async function readHomeRouter(
  binding: Pick<NetLensNativeBinding, 'tcpFetch'>,
  iface: InterfaceInfo,
  locations: readonly string[],
): Promise<{ routerId: string; routerUrl: string } | null> {
  for (const url of locations.slice(0, MAX_ROUTER_URLS)) {
    const target = parseHttpUrl(url);
    if (!target || target.ip !== iface.gatewayIp) continue;
    const res = await httpRequest(binding, iface, target, { maxBytes: MAX_XML });
    const routerId = res && res.status === 200 ? routerIdOf(res.body) : null;
    if (routerId) return { routerId, routerUrl: url };
  }
  return null;
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
      ? {
          networkId: str(h.networkId)!,
          gatewayIp: str(h.gatewayIp)!,
          label: str(h.label) ?? '',
          routerId: str(h.routerId) ?? '',
          routerUrl: str(h.routerUrl) ?? '',
        }
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
