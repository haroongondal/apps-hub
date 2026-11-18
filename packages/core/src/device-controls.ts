/**
 * Finds out which LAN devices can be controlled from the phone. Detection is GET-only and reads
 * state at most: nothing here switches, plays or changes anything. Every request goes through
 * httpRequest (LAN guard) and a reply that is odd or missing just means "not that kind".
 */
import { httpRequest, parseHttpUrl, parseJsonObject } from './lan-http.ts';
import type { HttpTarget } from './lan-http.ts';
import type { InterfaceInfo } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';
import { MAX_XML, resolveControl, serviceBlocks, tagText, withoutComments } from './igd.ts';
import type { SoapService } from './upnp-soap.ts';

type Binding = Pick<NetLensNativeBinding, 'tcpFetch'>;

export type DetectedControl =
  | { kind: 'roku' }
  | { kind: 'dlna'; rendering: SoapService | null; transport: SoapService | null }
  | { kind: 'shelly'; gen: 1 | 2 }
  | { kind: 'tasmota'; locked: boolean }
  | { kind: 'wled' };

const MEDIA_SERVICE = /^urn:schemas-upnp-org:service:(RenderingControl|AVTransport):\d+$/;
const PROBE_MS = 1500;
const JSON_MAX_BYTES = 16384;
const MAX_LOCATIONS = 4;

/** First RenderingControl:* and AVTransport:*; a control URL that is bad or points at another host gives null for that service. */
export function findMediaServices(
  descriptionXml: string,
  location: HttpTarget,
): { rendering: SoapService | null; transport: SoapService | null } {
  const out: { rendering: SoapService | null; transport: SoapService | null } = { rendering: null, transport: null };
  if (typeof descriptionXml !== 'string' || descriptionXml.length > MAX_XML) return out;
  // Same refusal as igd: real descriptions never declare entities.
  if (/<!(?:DOCTYPE|ENTITY)/i.test(descriptionXml)) return out;
  const xml = withoutComments(descriptionXml);
  const baseUrl = tagText(xml, 'URLBase');
  const base = (baseUrl !== null ? parseHttpUrl(baseUrl) : null) ?? location;
  const seen = new Set<string>();
  for (const block of serviceBlocks(xml)) {
    const type = tagText(block, 'serviceType');
    const kind = type === null ? null : MEDIA_SERVICE.exec(type)?.[1];
    const url = tagText(block, 'controlURL');
    // The type lands unescaped in the SOAP envelope, so only exact URNs pass.
    if (!type || !kind || url === null || seen.has(kind)) continue;
    seen.add(kind);
    const control = resolveControl(url, base);
    if (control && control.ip === location.ip) out[kind === 'AVTransport' ? 'transport' : 'rendering'] = { serviceType: type, control };
  }
  return out;
}

async function detectRoku(binding: Binding, iface: InterfaceInfo, ip: string): Promise<DetectedControl | null> {
  const res = await httpRequest(binding, iface, { ip, port: 8060, path: '/query/device-info' }, { method: 'GET', timeoutMs: PROBE_MS, maxBytes: JSON_MAX_BYTES });
  return res?.status === 200 && res.body.includes('<device-info') ? { kind: 'roku' } : null;
}

async function detectShelly(binding: Binding, iface: InterfaceInfo, ip: string): Promise<DetectedControl | null> {
  const res = await httpRequest(binding, iface, { ip, port: 80, path: '/shelly' }, { method: 'GET', timeoutMs: PROBE_MS, maxBytes: JSON_MAX_BYTES });
  const json = res?.status === 200 ? parseJsonObject(res.body) : null;
  if (!json) return null;
  if (typeof json.gen === 'number' && Number.isFinite(json.gen)) return { kind: 'shelly', gen: json.gen >= 2 ? 2 : 1 };
  // Gen1 has no "gen" field, only a type like "SHSW-1".
  return json.gen === undefined && typeof json.type === 'string' ? { kind: 'shelly', gen: 1 } : null;
}

async function detectTasmota(binding: Binding, iface: InterfaceInfo, ip: string): Promise<DetectedControl | null> {
  // "cmnd=Power" with no argument only reports the state.
  const res = await httpRequest(binding, iface, { ip, port: 80, path: '/cm?cmnd=Power' }, { method: 'GET', timeoutMs: PROBE_MS, maxBytes: JSON_MAX_BYTES });
  const json = res && (res.status === 200 || res.status === 401) ? parseJsonObject(res.body) : null;
  // Tasmota's 401 body is {"WARNING":"Need user=..."}; a bare 401 is any device with a password.
  if (res?.status === 401) return typeof json?.WARNING === 'string' ? { kind: 'tasmota', locked: true } : null;
  return json && Object.entries(json).some(([k, v]) => /^POWER\d*$/.test(k) && typeof v === 'string') ? { kind: 'tasmota', locked: false } : null;
}

async function detectWled(binding: Binding, iface: InterfaceInfo, ip: string): Promise<DetectedControl | null> {
  const res = await httpRequest(binding, iface, { ip, port: 80, path: '/json/info' }, { method: 'GET', timeoutMs: PROBE_MS, maxBytes: JSON_MAX_BYTES });
  return (res?.status === 200 ? parseJsonObject(res.body) : null)?.brand === 'WLED' ? { kind: 'wled' } : null;
}

async function mediaAt(binding: Binding, iface: InterfaceInfo, target: HttpTarget) {
  const res = await httpRequest(binding, iface, target, { method: 'GET', timeoutMs: PROBE_MS, maxBytes: MAX_XML });
  return res?.status === 200 ? findMediaServices(res.body, target) : null;
}

async function detectDlna(
  binding: Binding,
  iface: InterfaceInfo,
  ip: string,
  ssdpLocations: readonly string[],
): Promise<DetectedControl | null> {
  const targets = new Map<string, HttpTarget>();
  for (const loc of ssdpLocations) {
    const t = parseHttpUrl(loc);
    // A device can advertise someone else's address; only its own description is fetched.
    if (t && t.ip === ip && targets.size < MAX_LOCATIONS) targets.set(`${t.port}${t.path}`, t);
  }
  const rendering: SoapService[] = [];
  const transport: SoapService[] = [];
  const collect = (r: Awaited<ReturnType<typeof mediaAt>>): void => {
    if (r?.rendering) rendering.push(r.rendering);
    if (r?.transport) transport.push(r.transport);
  };
  (await Promise.all([...targets.values()].map((t) => mediaAt(binding, iface, t)))).forEach(collect);
  if (!rendering.length && !transport.length) collect(await mediaAt(binding, iface, { ip, port: 1400, path: '/xml/device_description.xml' }));
  return rendering.length || transport.length ? { kind: 'dlna', rendering: rendering[0] ?? null, transport: transport[0] ?? null } : null;
}

/** Runs every probe in parallel, each at most 1500 ms (the Sonos fallback runs after the location fetches). Never throws. */
export async function detectControls(
  binding: Binding,
  iface: InterfaceInfo,
  ip: string,
  ssdpLocations: readonly string[],
): Promise<DetectedControl[]> {
  const safe = (p: Promise<DetectedControl | null>): Promise<DetectedControl | null> => p.catch(() => null);
  const found = await Promise.all([
    safe(detectRoku(binding, iface, ip)),
    safe(detectDlna(binding, iface, ip, ssdpLocations)),
    safe(detectShelly(binding, iface, ip)),
    safe(detectTasmota(binding, iface, ip)),
    safe(detectWled(binding, iface, ip)),
  ]);
  return found.filter((c): c is DetectedControl => c !== null);
}
