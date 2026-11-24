// The background pass has only TCP answers, so a device is keyed by its address: every saved row
// (any identity kind) is known at its last address. Kotlin twin: NewDevices.find; both run fixtures/new-device-cases.json.

export const NEW_DEVICE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export interface AliveHost {
  ip: string;
  port: number | null;
}

export interface KnownHost {
  ip: string;
  lastSeenAt: number;
  tagged: boolean;
}

export interface NewDeviceAlert {
  ip: string;
  firstSeenAt: number;
  label: string;
  acknowledged: boolean;
}

export interface NewDeviceContext {
  selfIp: string;
  gatewayIp: string | null;
  now: number;
  windowDays: number;
}

export function findNewDevices(
  alive: readonly AliveHost[],
  known: readonly KnownHost[],
  alerts: readonly NewDeviceAlert[],
  ctx: NewDeviceContext,
): AliveHost[] {
  const since = ctx.now - ctx.windowDays * DAY_MS;
  const skip = new Set<string>([ctx.selfIp, ...(ctx.gatewayIp ? [ctx.gatewayIp] : [])]);
  for (const k of known) if (k.tagged || k.lastSeenAt >= since) skip.add(k.ip);
  // "This is mine" ages out with the report: an address alone cannot say it is still the same device.
  for (const a of alerts) if (a.firstSeenAt >= since) skip.add(a.ip);
  const fresh: AliveHost[] = [];
  for (const host of alive) {
    if (skip.has(host.ip)) continue;
    skip.add(host.ip);
    fresh.push(host);
  }
  return fresh;
}

export function deviceGuess(port: number | null): string {
  if (port === 62078) return 'iPhone or iPad';
  if (port === 445) return 'Computer';
  return 'Unknown device';
}
