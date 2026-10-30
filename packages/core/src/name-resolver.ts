/** Best-effort device name lookups after a sweep; nothing here rejects. */
import { cleanMdnsInstanceName, sanitizeName, type DeviceNames } from './device-names.ts';
import {
  buildNetbiosStatusRequest,
  buildPtrQuery,
  extractDeviceDescription,
  parseHttpResponse,
  parseNetbiosStatus,
  parsePtrAnswer,
  ssdpDescriptionRequest,
} from './name-formats.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

export const NAME_CONCURRENCY = 16;
export const NAME_LOOKUP_TIMEOUT_MS = 1500;
export const SSDP_DESCRIPTION_MAX_BYTES = 65536;

export interface NameTarget {
  ip: string;
  ssdpLocation: string | null;
  mdnsName: string | null;
}

type NameBinding = Pick<NetLensNativeBinding, 'udpRequest' | 'tcpFetch'>;

const queryId = (): number => Math.floor(Math.random() * 0x10000);

async function attempt<T>(lookup: () => Promise<T | null>): Promise<T | null> {
  try {
    return await lookup();
  } catch {
    return null;
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
  const [hostname, netbiosName, description] = await Promise.all([
    gatewayIp
      ? attempt(() =>
          udpName(binding, gatewayIp, 53, (id) => buildPtrQuery(target.ip, id), parsePtrAnswer, timeoutMs),
        )
      : null,
    attempt(() =>
      udpName(binding, target.ip, 137, buildNetbiosStatusRequest, parseNetbiosStatus, timeoutMs),
    ),
    attempt(() => describe(binding, target, timeoutMs)),
  ]);
  return {
    hostname,
    netbiosName,
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
