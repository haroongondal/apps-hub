export type FeatureKey = 'ads' | 'trackers' | 'distraction' | 'cookies' | 'antiadblock' | 'ai';

export const FEATURES: readonly FeatureKey[] = ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock', 'ai'];

export type AllowEntry = { kind: 'site'; host: string } | { kind: 'page'; url: string };

export interface Channel {
  id: string;
  name: string;
}

export interface Settings {
  version: 1;
  enabled: boolean;
  blocking: {
    paused: boolean;
    lists: Record<FeatureKey, boolean>;
    denyNotifications: boolean;
    allowlist: AllowEntry[];
    myFilters: string;
    youtubeAllowedChannels: Channel[];
  };
}

function defaults(): Settings {
  return {
    version: 1,
    enabled: true,
    blocking: {
      paused: false,
      lists: { ads: true, trackers: true, distraction: true, cookies: true, antiadblock: true, ai: false },
      denyNotifications: true,
      allowlist: [],
      myFilters: '',
      youtubeAllowedChannels: [],
    },
  };
}

export const DEFAULT_SETTINGS: Settings = defaults();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const OCTET = /^(0|[1-9][0-9]{0,2})$/;

// A host whose last label is a number must be a full IPv4 address: the URL parser reads it as one, so anything else never matches a page.
// shortcut: IPv6 literals are not accepted, add them if a local IPv6 site ever needs the allowlist.
function isHost(host: string): boolean {
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  const labels = host.split('.');
  if (labels.includes('')) return false;
  if (!/^[0-9]+$/.test(labels[labels.length - 1])) return true;
  return labels.length === 4 && labels.every((l) => OCTET.test(l) && Number(l) <= 255);
}

function pageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function allowlist(raw: unknown): AllowEntry[] {
  const out: AllowEntry[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    let entry: AllowEntry | null = null;
    if (item.kind === 'site' && typeof item.host === 'string') {
      const host = item.host.trim().toLowerCase();
      if (isHost(host)) entry = { kind: 'site', host };
    } else if (item.kind === 'page' && typeof item.url === 'string') {
      const url = pageUrl(item.url);
      if (url !== null) entry = { kind: 'page', url };
    }
    if (entry === null) continue;
    const key = entry.kind === 'site' ? `s:${entry.host}` : `p:${entry.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function channels(raw: unknown): Channel[] {
  const out: Channel[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item) || !text(item.id) || !text(item.name) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ id: item.id, name: item.name });
  }
  return out;
}

export function validateSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isRecord(input) || input.version !== 1) return defaults();
  const b = isRecord(input.blocking) ? input.blocking : {};
  const rawLists = isRecord(b.lists) ? b.lists : {};
  const lists = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURES) lists[key] = bool(rawLists[key], d.blocking.lists[key]);
  return {
    version: 1,
    enabled: bool(input.enabled, d.enabled),
    blocking: {
      paused: bool(b.paused, d.blocking.paused),
      lists,
      denyNotifications: bool(b.denyNotifications, d.blocking.denyNotifications),
      allowlist: allowlist(b.allowlist),
      myFilters: typeof b.myFilters === 'string' ? b.myFilters : '',
      youtubeAllowedChannels: channels(b.youtubeAllowedChannels),
    },
  };
}
