/** Wire formats for device-name lookups; parsers never throw, bad input gives null. */
import { isPrivateIpv4 } from './device-names.ts';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u16 = (b: readonly number[], i: number): number => (b[i] << 8) | b[i + 1];
const header = (id: number, flags: number): number[] => [
  (id >> 8) & 0xff,
  id & 0xff,
  flags >> 8,
  flags & 0xff,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
];

export function buildPtrQuery(ip: string, id: number): number[] {
  const labels = [...ip.split('.').reverse(), 'in-addr', 'arpa'];
  const name = labels.flatMap((l) => [l.length, ...ascii(l)]);
  return [...header(id, 0x0100), ...name, 0, 0, 12, 0, 1];
}

function readName(
  b: readonly number[],
  start: number,
): { name: string; end: number } | null {
  const labels: string[] = [];
  let off = start;
  let end = -1;
  let jumps = 0;
  for (;;) {
    const len = b[off];
    if (len === undefined) return null;
    if (len === 0) return { name: labels.join('.'), end: end < 0 ? off + 1 : end };
    if ((len & 0xc0) === 0xc0) {
      const low = b[off + 1];
      if (low === undefined || ++jumps > 16) return null;
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | low;
    } else if (len > 63 || off + 1 + len > b.length) {
      return null;
    } else {
      labels.push(String.fromCharCode(...b.slice(off + 1, off + 1 + len)));
      off += 1 + len;
    }
  }
}

function answersStart(
  b: readonly number[],
  id: number,
): { off: number; count: number } | null {
  if (b.length < 12 || u16(b, 0) !== id) return null;
  const flags = u16(b, 2);
  if (!(flags & 0x8000) || (flags & 0xf) !== 0) return null;
  let off = 12;
  for (let i = u16(b, 4); i > 0; i--) {
    const q = readName(b, off);
    if (!q || q.end + 4 > b.length) return null;
    off = q.end + 4;
  }
  return { off, count: u16(b, 6) };
}

function readRecord(
  b: readonly number[],
  off: number,
): { type: number; data: number; end: number } | null {
  const n = readName(b, off);
  if (!n || n.end + 10 > b.length) return null;
  const data = n.end + 10;
  const end = data + u16(b, n.end + 8);
  return end > b.length ? null : { type: u16(b, n.end), data, end };
}

export function parsePtrAnswer(bytes: readonly number[], id: number): string | null {
  const start = answersStart(bytes, id);
  if (!start) return null;
  let off = start.off;
  for (let i = 0; i < start.count; i++) {
    const rec = readRecord(bytes, off);
    if (!rec) return null;
    if (rec.type === 12) return readName(bytes, rec.data)?.name || null;
    off = rec.end;
  }
  return null;
}

export function buildNetbiosStatusRequest(id: number): number[] {
  return [
    ...header(id, 0),
    0x20,
    ...ascii('CK'),
    ...Array<number>(30).fill(0x41),
    0,
    0,
    0x21,
    0,
    1,
  ];
}

export function parseNetbiosStatus(bytes: readonly number[], id: number): string | null {
  const start = answersStart(bytes, id);
  if (!start || start.count < 1) return null;
  const rec = readRecord(bytes, start.off);
  if (!rec || rec.type !== 0x21 || rec.end <= rec.data) return null;
  const count = bytes[rec.data];
  if (rec.data + 1 + count * 18 > rec.end) return null;
  for (let i = 0; i < count; i++) {
    const p = rec.data + 1 + i * 18;
    if (bytes[p + 15] !== 0 || u16(bytes, p + 16) & 0x8000) continue;
    const name = String.fromCharCode(...bytes.slice(p, p + 15)).replace(/[\s\0]+$/, '');
    return name || null;
  }
  return null;
}

// No URL: React Native's URL lacks hostname and port.
const SSDP_LOCATION = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?(\/\S*)?$/i;

export function ssdpDescriptionRequest(
  location: string,
  responderIp: string,
): { ip: string; port: number; request: string } | null {
  const m = SSDP_LOCATION.exec(location);
  if (!m) return null;
  const ip = m[1];
  const port = m[2] === undefined ? 80 : Number(m[2]);
  if (ip !== responderIp || !isPrivateIpv4(ip) || port < 1 || port > 65535) return null;
  const request = `GET ${m[3] ?? '/'} HTTP/1.0\r\nHost: ${ip}:${port}\r\nConnection: close\r\n\r\n`;
  return { ip, port, request };
}

export function parseHttpResponse(raw: string): { status: number; body: string } | null {
  const m = /^HTTP\/\d(?:\.\d)?[ \t]+(\d{3})(?:[ \t][^\r\n]*)?\r\n/.exec(raw);
  const split = raw.indexOf('\r\n\r\n');
  if (!m || split < 0) return null;
  return { status: Number(m[1]), body: raw.slice(split + 4) };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function tagText(xml: string, tag: string): string | null {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`).exec(xml);
  if (!open) return null;
  const from = open.index + open[0].length;
  const end = xml.indexOf(`</${tag}>`, from);
  if (end < 0) return null;
  return xml.slice(from, end).replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
}

export function extractDeviceDescription(xml: string): {
  friendlyName: string | null;
  manufacturer: string | null;
  modelName: string | null;
} {
  const body = xml
    .replace(/<!ENTITY\s(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return {
    friendlyName: tagText(body, 'friendlyName'),
    manufacturer: tagText(body, 'manufacturer'),
    modelName: tagText(body, 'modelName'),
  };
}
