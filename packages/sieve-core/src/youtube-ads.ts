import { isAllowed } from './allowlist.ts';
import type { Channel, Settings } from './settings.ts';

export const AD_KEYS: readonly string[] = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const channelOf = (r: Record<string, unknown>): unknown => (isObject(r.videoDetails) ? r.videoDetails.channelId : undefined);

function stripOne(r: Record<string, unknown>, channelId: unknown, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(channelId as string)) return false;
  let removed = false;
  // Reflect.deleteProperty returns false on a frozen object where `delete` would throw in strict mode.
  for (const key of AD_KEYS) if (Object.hasOwn(r, key) && Reflect.deleteProperty(r, key)) removed = true;
  return removed;
}

function stripResponse(r: unknown, allowed: ReadonlySet<string>): boolean {
  if (!isObject(r)) return false;
  const inner = isObject(r.playerResponse) ? r.playerResponse : null;
  const innerChannel = inner === null ? undefined : channelOf(inner);
  const top = stripOne(r, isObject(r.videoDetails) ? channelOf(r) : innerChannel, allowed);
  return (inner !== null && stripOne(inner, innerChannel, allowed)) || top;
}

// A short array is YouTube's `[{page}, {playerResponse}]` shape; a longer one is never player data, and is not walked.
export function stripAds(response: unknown, allowedChannelIds: ReadonlySet<string>): boolean {
  try {
    if (!Array.isArray(response)) return stripResponse(response, allowedChannelIds);
    let removed = false;
    if (response.length <= 5) for (const item of response) if (stripResponse(item, allowedChannelIds)) removed = true;
    return removed;
  } catch {
    return false;
  }
}

export function ytChannel(detail: unknown): (Channel & { videoId: string }) | null {
  if (!isObject(detail) || typeof detail.id !== 'string' || !CHANNEL_ID.test(detail.id) || typeof detail.name !== 'string') return null;
  if (typeof detail.videoId !== 'string' || !VIDEO_ID.test(detail.videoId)) return null;
  const name = detail.name.trim().slice(0, 100);
  return name ? { id: detail.id, name, videoId: detail.videoId } : null;
}

export function watchChannel(pageUrl: string, seen: ReadonlyMap<string, Channel>): Channel | null {
  const url = new URL(pageUrl);
  return url.pathname === '/watch' ? (seen.get(url.searchParams.get('v') ?? '') ?? null) : null;
}

// Ancestors are origins only (location.ancestorOrigins), so a page entry can't be matched against them; a site entry can.
export function youtubeAdsOn(settings: Settings, url: string, ancestorOrigins: readonly string[] = []): boolean {
  const b = settings.blocking;
  const sites = b.allowlist.filter((e) => e.kind === 'site');
  return settings.enabled && !b.paused && b.lists.ads && !isAllowed(url, b.allowlist) && !ancestorOrigins.some((o) => isAllowed(o, sites));
}
