/**
 * The one gate for LAN HTTP: native tcpFetch accepts any IP, so every request goes
 * through isLanTarget and is built here (no header or path injection).
 */
import { formatIpv4, parseIpv4, prefixToMask } from './ipv4.ts';
import { isPrivateIpv4 } from './device-names.ts';
import type { InterfaceInfo } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';
import { parseHttpResponse } from './name-formats.ts';

export interface HttpTarget {
  ip: string;
  port: number;
  path: string;
}

// No URL: React Native's URL lacks hostname and port.
const HTTP_URL = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?(\/[\x21-\x7E]*)?$/i;
const PATH = /^\/[\x21-\x7E]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const OWN_HEADERS = new Set(['host', 'connection', 'content-length']);
// A /0../7 interface is nonsense (or a bug): refuse everything rather than a continent.
const MIN_PREFIX = 8;

/** True only for a canonical private IPv4 inside the phone's own subnet, excluding its network and broadcast address. */
export function isLanTarget(ip: string, iface: InterfaceInfo): boolean {
  if (typeof ip !== 'string' || !iface || typeof iface.localIp !== 'string') return false;
  const prefix = iface.cidrPrefix;
  if (!Number.isInteger(prefix) || prefix < MIN_PREFIX || prefix > 32) return false;
  const target = parseIpv4(ip);
  const local = parseIpv4(iface.localIp);
  // Canonical form only: "192.168.001.1" parses here but is octal in some C resolvers.
  if (target === null || local === null || formatIpv4(target) !== ip) return false;
  if (!isPrivateIpv4(ip) || !isPrivateIpv4(iface.localIp)) return false;
  const mask = prefixToMask(prefix);
  if (((target ^ local) & mask) !== 0) return false;
  if (prefix >= 31) return true;
  return target !== ((local & mask) >>> 0) && target !== (((local & mask) | ~mask) >>> 0);
}

/** `http://a.b.c.d[:port]/path`, or a path (starting with "/") resolved against `base`. Null for anything else. */
export function parseHttpUrl(url: string, base?: HttpTarget): HttpTarget | null {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/')) return base && PATH.test(url) ? { ip: base.ip, port: base.port, path: url } : null;
  const m = HTTP_URL.exec(url);
  if (!m) return null;
  const ip = parseIpv4(m[1]);
  const port = m[2] === undefined ? 80 : Number(m[2]);
  if (ip === null || formatIpv4(ip) !== m[1] || port < 1 || port > 65535) return null;
  return { ip: m[1], port, path: m[3] ?? '/' };
}

export async function httpRequest(
  binding: Pick<NetLensNativeBinding, 'tcpFetch'>,
  iface: InterfaceInfo,
  target: HttpTarget,
  init: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
  },
): Promise<{ status: number; body: string } | null> {
  const { ip, port, path } = target;
  if (!isLanTarget(ip, iface)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !PATH.test(path)) return null;
  const method = init.method ?? 'GET';
  if (method !== 'GET' && method !== 'POST') return null;
  let head = `${method} ${path} HTTP/1.0\r\nHost: ${ip}:${port}\r\nConnection: close\r\n`;
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    if (!HEADER_NAME.test(name) || OWN_HEADERS.has(name.toLowerCase()) || /[\r\n\0]/.test(value)) return null;
    head += `${name}: ${value}\r\n`;
  }
  const body = init.body;
  if (body !== undefined) head += `Content-Length: ${new TextEncoder().encode(body).length}\r\n`;
  try {
    const raw = await binding.tcpFetch(ip, port, `${head}\r\n${body ?? ''}`, init.timeoutMs ?? 1500, init.maxBytes ?? 65536);
    return raw === null ? null : parseHttpResponse(raw);
  } catch {
    return null;
  }
}

export function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(body);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
