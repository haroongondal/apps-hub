/** Best-effort device name lookups after a sweep; nothing here rejects. */
import { cleanMdnsInstanceName, sanitizeName, type DeviceNames } from './device-names.ts';
import {
  buildNetbiosStatusRequest,
  buildPtrQuery,
  extractDeviceDescription,
  parseHttpResponse,
  parseNetbiosMac,
  parseNetbiosStatus,
  parsePtrAnswer,
  ssdpDescriptionRequest,
} from './name-formats.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

export const NAME_CONCURRENCY = 16;
export const NAME_LOOKUP_TIMEOUT_MS = 1500;
export const SSDP_DESCRIPTION_MAX_BYTES = 65536;
const GUARD_MS = 250;

export interface NameTarget {
  ip: string;
  ssdpLocation: string | null;
  mdnsName: string | null;
}

type NameBinding = Pick<NetLensNativeBinding, 'udpRequest' | 'tcpFetch'>;

const queryId = (): number => Math.floor(Math.random() * 0x10000);

// The native side owns the timeout; this only stops a lookup that never settles.
async function attempt<T>(lookup: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs + GUARD_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function udpName(
  binding: NameBinding,
  ip: string,
  port: number,
  build: (id: number) => number[],
  parse: (reply: number[], id: number) => string | null,
  timeoutMs: number,
): Promise<string | null> {
  const id = queryId();
  const reply = await binding.udpRequest(ip, port, build(id), timeoutMs);
  return sanitizeName(reply && parse(reply, id));
}

// One NBSTAT reply carries both the machine name and its MAC.
async function netbiosLookup(
  binding: NameBinding,
  ip: string,
  timeoutMs: number,
): Promise<Pick<DeviceNames, 'netbiosName' | 'mac'>> {
  const id = queryId();
  const reply = await binding.udpRequest(ip, 137, buildNetbiosStatusRequest(id), timeoutMs);
  return {
    netbiosName: sanitizeName(reply && parseNetbiosStatus(reply, id)),
    mac: reply && parseNetbiosMac(reply, id),
  };
}

async function describe(
  binding: NameBinding,
  target: NameTarget,
  timeoutMs: number,
): Promise<Pick<DeviceNames, 'friendlyName' | 'model'>> {
  const none = { friendlyName: null, model: null };
  const req = target.ssdpLocation && ssdpDescriptionRequest(target.ssdpLocation, target.ip);
  if (!req) return none;
  const raw = await binding.tcpFetch(
    req.ip,
    req.port,
    req.request,
    timeoutMs,
    SSDP_DESCRIPTION_MAX_BYTES,
  );
  const http = raw === null ? null : parseHttpResponse(raw);
  if (http?.status !== 200) return none;
  const { friendlyName, manufacturer, modelName } = extractDeviceDescription(http.body);
  return {
    friendlyName: sanitizeName(friendlyName),
    model: sanitizeName([manufacturer, modelName].filter(Boolean).join(' ')),
  };
}

async function lookupNames(
  binding: NameBinding,
  target: NameTarget,
  gatewayIp: string | null,
  timeoutMs: number,
): Promise<DeviceNames> {
  const [hostname, netbios, description] = await Promise.all([
    gatewayIp
      ? attempt(
          () =>
            udpName(binding, gatewayIp, 53, (id) => buildPtrQuery(target.ip, id), parsePtrAnswer, timeoutMs),
          timeoutMs,
        )
      : null,
    attempt(() => netbiosLookup(binding, target.ip, timeoutMs), timeoutMs),
    attempt(() => describe(binding, target, timeoutMs), timeoutMs),
  ]);
  return {
    hostname,
    netbiosName: netbios?.netbiosName ?? null,
    mac: netbios?.mac ?? null,
    mdnsName: target.mdnsName === null ? null : cleanMdnsInstanceName(target.mdnsName),
    friendlyName: description?.friendlyName ?? null,
    model: description?.model ?? null,
  };
}

export async function resolveDeviceNames(
  binding: NameBinding,
  targets: readonly NameTarget[],
  gatewayIp: string | null,
  onNames?: (ip: string, names: DeviceNames) => void,
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, DeviceNames>> {
  const timeoutMs = options.timeoutMs ?? NAME_LOOKUP_TIMEOUT_MS;
  const workers = Math.max(1, Math.min(options.concurrency ?? NAME_CONCURRENCY, targets.length));
  const results = new Map<string, DeviceNames>();
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      const names = await lookupNames(binding, target, gatewayIp, timeoutMs);
      results.set(target.ip, names);
      try {
        onNames?.(target.ip, names);
      } catch {
        // A listener bug must not stop the remaining lookups.
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
