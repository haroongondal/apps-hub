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

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// A host the URL parser rewrites or refuses (1.2.3, 0x7f.0.0.1, example.123) never matches a tab, so it is not a host.
// shortcut: IPv6 literals are not accepted, add them if a local IPv6 site ever needs the allowlist.
function isHost(host: string): boolean {
  if (host.length > 253 || !host.split('.').every((l) => l.length <= 63 && LABEL.test(l))) return false;
  try {
    return new URL(`http://${host}`).hostname === host;
  } catch {
    return false;
  }
}

// Page entries and the tab URLs compared with them: http(s) only, no hash, no userinfo.
export function pageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.username = '';
    u.password = '';
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
      const host = item.host.trim().toLowerCase().replace(/\.$/, '');
      if (isHost(host)) entry = { kind: 'site', host };
    } else if (item.kind === 'page' && typeof item.url === 'string') {
      const url = pageUrl(item.url);
      // The page becomes a match pattern, and one host Chrome refuses there (`a*b.com`) voids every registration.
      if (url !== null && isHost(new URL(url).hostname)) entry = { kind: 'page', url };
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
    if (!isRecord(item) || !text(item.id) || !text(item.name)) continue;
    const id = item.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: item.name.trim() });
  }
  return out;
}

export function validateSettings(input: unknown): Settings {
  const d = defaults();
  if (!isRecord(input) || (input.version !== undefined && input.version !== 1)) return d;
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
