/**
 * UPnP internet gateway (IGD) client. Everything a router or any LAN device says is untrusted:
 * every request goes through soapCall/httpRequest (LAN guard) and nothing here throws.
 */
import { httpRequest, parseHttpUrl } from './lan-http.ts';
import type { HttpTarget } from './lan-http.ts';
import type { InterfaceInfo, ServiceEvent } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';
import { soapCall } from './upnp-soap.ts';
import type { SoapService } from './upnp-soap.ts';

type Binding = Pick<NetLensNativeBinding, 'tcpFetch'>;

export interface IgdServices {
  wan: SoapService;
  common: SoapService | null;
}

export const MAX_XML = 262144;
const MAX_LOCATIONS = 8;
const MAX_MAPPINGS = 64;
const WAN_IP = /^urn:schemas-upnp-org:service:WANIPConnection:\d+$/;
const WAN_PPP = 'urn:schemas-upnp-org:service:WANPPPConnection:1';
const WAN_COMMON = 'urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1';
// The lookahead stops a block at the next <service, so an unclosed tag cannot rescan to the end (quadratic).
const SERVICE_BLOCK = /<service\b[^<>]*>((?:(?!<service\b)[\s\S])*?)<\/service\s*>/gi;
const IGD_HINT = /InternetGatewayDevice|WANIPConnection|WANPPPConnection/i;

const XML_NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_NAMED[e]);

/** Inner text of each <service> block. The /g regex stays private: a caller's .test() would move its lastIndex. */
export const serviceBlocks = (xml: string): string[] => Array.from(xml.matchAll(SERVICE_BLOCK), (m) => m[1]);

// Linear scan, unlike a lazy regex, which goes quadratic on many unterminated "<!--".
export function withoutComments(xml: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const open = xml.indexOf('<!--', pos);
    if (open < 0) return out + xml.slice(pos);
    out += xml.slice(pos, open);
    const close = xml.indexOf('-->', open + 4);
    if (close < 0) return out;
    pos = close + 3;
  }
}

export function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\s*>([^<]*)</${tag}\\s*>`, 'i').exec(xml);
  return m ? decodeXml(m[1]).trim() : null;
}

export function resolveControl(url: string, base: HttpTarget): HttpTarget | null {
  return parseHttpUrl(/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') ? url : `/${url}`, base);
}

/** First WANIPConnection:*, else WANPPPConnection:1, plus WANCommonInterfaceConfig:1. Null when no WAN control URL is usable. */
export function findIgdServices(descriptionXml: string, location: HttpTarget): IgdServices | null {
  if (typeof descriptionXml !== 'string' || descriptionXml.length > MAX_XML) return null;
  // Real descriptions never declare entities; refusing them keeps decoding trivial.
  if (/<!(?:DOCTYPE|ENTITY)/i.test(descriptionXml)) return null;
  const xml = withoutComments(descriptionXml);
  const baseUrl = tagText(xml, 'URLBase');
  const base = (baseUrl !== null ? parseHttpUrl(baseUrl) : null) ?? location;
  const ip: SoapService[] = [];
  const ppp: SoapService[] = [];
  let common: SoapService | null = null;
  for (const block of serviceBlocks(xml)) {
    const type = tagText(block, 'serviceType');
    const url = tagText(block, 'controlURL');
    // The type lands unescaped in the SOAP envelope and header, so only exact known URNs pass.
    if (type === null || url === null) continue;
    const isIp = WAN_IP.test(type);
    if (!isIp && type !== WAN_PPP && !(type === WAN_COMMON && common === null)) continue;
    const control = resolveControl(url, base);
    if (!control) continue;
    if (type === WAN_COMMON) common = { serviceType: type, control };
    else (isIp ? ip : ppp).push({ serviceType: type, control });
  }
  const wan = ip[0] ?? ppp[0];
  return wan ? { wan, common } : null;
}

/** Tries the gateway's own SSDP answers (IGD-looking ones first); first usable description wins. */
export async function discoverIgd(
  binding: Binding,
  iface: InterfaceInfo,
  events: readonly ServiceEvent[],
): Promise<IgdServices | null> {
  const gateway = iface.gatewayIp;
  if (!gateway) return null;
  const hinted: HttpTarget[] = [];
  const rest: HttpTarget[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'ssdp' || e.host !== gateway || typeof e.location !== 'string' || seen.has(e.location)) continue;
    const target = parseHttpUrl(e.location);
    if (!target || target.ip !== gateway) continue;
    seen.add(e.location);
    (IGD_HINT.test(`${e.usn} ${e.location} ${e.server}`) ? hinted : rest).push(target);
  }
  for (const target of [...hinted, ...rest].slice(0, MAX_LOCATIONS)) {
    const res = await httpRequest(binding, iface, target, { maxBytes: MAX_XML });
    const igd = res && res.status === 200 ? findIgdServices(res.body, target) : null;
    // A URLBase or absolute controlURL could point SOAP calls (DeletePortMapping) at another LAN host.
    if (igd && igd.wan.control.ip === gateway) {
      return { wan: igd.wan, common: igd.common?.control.ip === gateway ? igd.common : null };
    }
  }
  return null;
}

export interface RouterFacts {
  externalIp: string | null;
  connected: boolean | null;
  uptimeSec: number | null;
  maxDownBps: number | null;
  maxUpBps: number | null;
}

const uint = (v: string | undefined): number | null => {
  if (v === undefined || !/^\d{1,16}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export async function getRouterFacts(binding: Binding, iface: InterfaceInfo, igd: IgdServices): Promise<RouterFacts> {
  const [ip, status, link] = await Promise.all([
    soapCall(binding, iface, igd.wan, 'GetExternalIPAddress'),
    soapCall(binding, iface, igd.wan, 'GetStatusInfo'),
    igd.common ? soapCall(binding, iface, igd.common, 'GetCommonLinkProperties') : null,
  ]);
  const ipv = ip.ok ? ip.values.NewExternalIPAddress : undefined;
  // A line speed of 0 means "unknown" on most routers.
  const speed = (name: string): number | null => (link?.ok ? uint(link.values[name]) || null : null);
  return {
    externalIp: ipv !== undefined && IPV4.test(ipv) ? ipv : null,
    connected: status.ok ? status.values.NewConnectionStatus === 'Connected' : null,
    uptimeSec: status.ok ? uint(status.values.NewUptime) : null,
    maxDownBps: speed('NewLayer1DownstreamMaxBitRate'),
    maxUpBps: speed('NewLayer1UpstreamMaxBitRate'),
  };
}

export interface ByteCounters {
  rx: number;
  tx: number;
  atMs: number;
}

export async function readByteCounters(
  binding: Binding,
  iface: InterfaceInfo,
  igd: IgdServices,
  nowMs: number,
): Promise<ByteCounters | null> {
  if (!igd.common) return null;
  const [rx, tx] = await Promise.all([
    soapCall(binding, iface, igd.common, 'GetTotalBytesReceived'),
    soapCall(binding, iface, igd.common, 'GetTotalBytesSent'),
  ]);
  const rxBytes = rx.ok ? uint(rx.values.NewTotalBytesReceived) : null;
  const txBytes = tx.ok ? uint(tx.values.NewTotalBytesSent) : null;
  return rxBytes === null || txBytes === null ? null : { rx: rxBytes, tx: txBytes, atMs: nowMs };
}

/** Bits per second between two samples. Null for no elapsed time or an implausible rate (a counter reset). */
export function rateBps(prev: ByteCounters, next: ByteCounters): { downBps: number; upBps: number } | null {
  const elapsed = next.atMs - prev.atMs;
  if (!(elapsed > 0)) return null;
  // Many routers keep 32-bit counters; a negative delta is a wrap only if the old value fit in 32 bits.
  const bps = (a: number, b: number): number => ((b - a < 0 && a < 2 ** 32 ? b - a + 2 ** 32 : b - a) * 8 * 1000) / elapsed;
  const downBps = bps(prev.rx, next.rx);
  const upBps = bps(prev.tx, next.tx);
  // Negative: a 64-bit counter that reset (the 32-bit wrap fix only covers counters below 2^32).
  return downBps >= 0 && downBps <= 10e9 && upBps >= 0 && upBps <= 10e9 ? { downBps, upBps } : null;
}

export interface PortMapping {
  remoteHost: string;
  externalPort: number;
  protocol: 'TCP' | 'UDP';
  internalClient: string;
  internalPort: number;
  description: string;
  enabled: boolean;
}

const port = (v: string | undefined): number | null => {
  const n = uint(v);
  return n !== null && n >= 1 && n <= 65535 ? n : null;
};

export async function listPortMappings(binding: Binding, iface: InterfaceInfo, igd: IgdServices): Promise<PortMapping[]> {
  const out: PortMapping[] = [];
  for (let i = 0; i < MAX_MAPPINGS; i++) {
    const res = await soapCall(binding, iface, igd.wan, 'GetGenericPortMappingEntry', [['NewPortMappingIndex', String(i)]]);
    if (!res.ok) break;
    const v = res.values;
    const externalPort = port(v.NewExternalPort);
    const internalPort = port(v.NewInternalPort);
    const protocol = v.NewProtocol;
    if (externalPort === null || internalPort === null || (protocol !== 'TCP' && protocol !== 'UDP')) continue;
    out.push({
      remoteHost: v.NewRemoteHost ?? '',
      externalPort,
      protocol,
      internalClient: v.NewInternalClient ?? '',
      internalPort,
      description: v.NewPortMappingDescription ?? '',
      enabled: v.NewEnabled === '1' || v.NewEnabled === 'true',
    });
  }
  return out;
}

export async function deletePortMapping(
  binding: Binding,
  iface: InterfaceInfo,
  igd: IgdServices,
  m: PortMapping,
): Promise<boolean> {
  const res = await soapCall(binding, iface, igd.wan, 'DeletePortMapping', [
    ['NewRemoteHost', m.remoteHost],
    ['NewExternalPort', String(m.externalPort)],
    ['NewProtocol', m.protocol],
  ]);
  return res.ok;
}
