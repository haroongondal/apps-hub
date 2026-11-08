import { isAllowed } from './allowlist.ts';
import type { Channel, Settings } from './settings.ts';

export const AD_KEYS: readonly string[] = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function stripOne(r: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const details = r.videoDetails;
  if (isObject(details) && allowed.has(details.channelId as string)) return false;
  let removed = false;
  // Reflect.deleteProperty returns false on a frozen object where `delete` would throw in strict mode.
  for (const key of AD_KEYS) if (Object.hasOwn(r, key) && Reflect.deleteProperty(r, key)) removed = true;
  return removed;
}

export function stripAds(response: unknown, allowedChannelIds: ReadonlySet<string>): boolean {
  if (!isObject(response)) return false;
  try {
    const top = stripOne(response, allowedChannelIds);
    const inner = response.playerResponse;
    return (isObject(inner) && stripOne(inner, allowedChannelIds)) || top;
  } catch {
    return false;
  }
}

export function ytChannel(detail: unknown): Channel | null {
  if (!isObject(detail) || typeof detail.id !== 'string' || !CHANNEL_ID.test(detail.id) || typeof detail.name !== 'string') return null;
  const name = detail.name.trim().slice(0, 100);
  return name ? { id: detail.id, name } : null;
}

// urls: the frame's own address and the pages around it, so an embed on an allowlisted site is left alone as inject.ts leaves its frames.
export function youtubeAdsOn(settings: Settings, urls: string[]): boolean {
  const b = settings.blocking;
  return settings.enabled && !b.paused && b.lists.ads && !urls.some((u) => isAllowed(u, b.allowlist));
}
