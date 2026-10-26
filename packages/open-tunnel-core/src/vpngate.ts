/**
 * VPN Gate CSV ingestion: parse, sanitize, protocol detect, config decode.
 * 1:1 port of `lib/core/network/vpngate_service.dart` parsing half.
 */
import { decodeBase64Tolerant, utf8DecodeTolerant } from './base64.ts';
import { createVpnNode, type VpnNode, type VpnTransport } from './vpn-node.ts';

export type { VpnNode, VpnTransport } from './vpn-node.ts';

/** Ordered fetch sources. HTTPS is preferred; the HTTP fallback is slow and
 * relies on the scoped cleartext policy configured for `vpngate.net`. */
export const VPN_GATE_SOURCES: readonly string[] = [
  'https://www.vpngate.net/api/iphone/',
  'http://www.vpngate.net/api/iphone/',
  'http://www.vpngate.net/api/iphone/?mirror=1',
];

/** Default when a row has no usable `remote <host> <port>` line downstream. */
export const DEFAULT_VPN_GATE_PORT = 1194;
export const DEFAULT_VPN_GATE_TRANSPORT: VpnTransport = 'udp';

/** The payload is roughly 1.3 MB upstream. A short total timeout dies
 * mid-body, so fetches connect fast and allow the transfer plenty of time. */
export const VPN_GATE_CONNECT_TIMEOUT_MS = 15_000;
export const VPN_GATE_RECEIVE_TIMEOUT_MS = 120_000;

const REMOTE_LINE = /^\s*remote\s+\S+\s+(\d+)\s*$/im;
const PROTO_LINE = /^\s*proto\s+(tcp4?|tcp6|tcp|udp4?|udp6|udp)\b/im;
const STRIPPED_DIRECTIVE =
  /^\s*(data-ciphers|data-ciphers-fallback|cipher|comp-lzo|compress)\b.*$/i;

/** Directives injected after the `client` preamble (exactly once). */
export const INJECTED_CIPHER_DIRECTIVES: readonly string[] = [
  'data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305:AES-128-CBC',
  'data-ciphers-fallback AES-128-CBC',
];

/**
 * Parses one VPN Gate row into a node, or returns null for headers, footers,
 * and rows that cannot be decoded.
 *
 * The base64 config is the **last** comma-separated field and never contains
 * commas itself, so the row is split from the final comma. Any extra commas
 * between the operator and message fields are folded back into the message
 * field instead of shifting the payload column.
 */
export function parseVpnGateCsvRow(line: string): VpnNode | null {
  const trimmed = line.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('#') ||
    trimmed === ','
  ) {
    return null;
  }

  const lastComma = trimmed.lastIndexOf(',');
  if (lastComma < 0 || lastComma === trimmed.length - 1) {
    return null;
  }
  const encoded = trimmed.substring(lastComma + 1).trim();
  const prefix = trimmed.substring(0, lastComma);
  const columns = prefix.split(',');
  if (columns.length < 14 || encoded.length === 0) {
    return null;
  }
  // Columns 0..12 are read as single fields. VPN Gate operator and message
  // text is not reliably comma-safe, so a naive left-to-right split would
  // shift those columns; when the payload splitting proves ambiguous the
  // operator field simply loses fidelity, never the config or the endpoint
  // data the app acts on.

  const decoded = decodeConfigBase64(encoded);
  if (decoded === null) {
    return null;
  }
  const sanitized = sanitizeOpenVpnConfig(decoded);
  const remote = extractRemote(sanitized);

  return createVpnNode({
    hostName: columns[0]!.trim(),
    ip: columns[1]!.trim(),
    port: remote.port ?? DEFAULT_VPN_GATE_PORT,
    transportProto: remote.transport,
    score: parseIntStrict(columns[2]) ?? 0,
    pingMs: parseIntStrict(columns[3]) ?? 0,
    speedBps: parseIntStrict(columns[4]) ?? 0,
    countryLong: columns[5]!.trim(),
    countryShort: columns[6]!.trim(),
    numSessions: parseIntStrict(columns[7]) ?? 0,
    // Upstream uptime is seconds; the model carries milliseconds.
    uptimeMs: (parseIntStrict(columns[8]) ?? 0) * 1000,
    operatorName: columns[12]!.trim(),
    ovpnConfigRaw: sanitized,
    protocol: detectVpnProtocol(sanitized),
  });
}

/** Streams a VPN Gate body line by line and yields decoded, sanitized nodes.
 * Never materialize the full body; upstream is multi-megabyte. */
export async function* parseVpnGateCsv(
  lines: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<VpnNode> {
  for await (const line of lines) {
    const node = parseVpnGateCsvRow(line);
    if (node !== null) {
      yield node;
    }
  }
}

/** Rewrites a decoded `.ovpn` payload so modern OpenVPN 2.6+ engines can
 * handshake with legacy academic servers.
 *
 * Idempotent by construction: existing cipher selection is removed, then the
 * compatibility block is injected exactly once, immediately after the
 * `client` preamble when one exists. Never log the input or output. */
export function sanitizeOpenVpnConfig(raw: string): string {
  if (raw.trim().length === 0) {
    return raw;
  }
  const hadTrailingNewline = raw.endsWith('\n');

  const withoutLegacy = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = withoutLegacy.split('\n').filter((line) => {
    return !STRIPPED_DIRECTIVE.test(line);
  });

  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*client\b/i.test(lines[i]!)) {
      insertAt = i + 1;
      break;
    }
  }
  lines.splice(insertAt, 0, ...INJECTED_CIPHER_DIRECTIVES);

  const sanitized = lines.join('\n');
  // `split` keeps the trailing empty element for newline-terminated input, so
  // the join already restored the terminator; never append a second one.
  if (hadTrailingNewline && !sanitized.endsWith('\n')) {
    return `${sanitized}\n`;
  }
  return sanitized;
}

/** Detects the payload protocol by content, never by naming convention. */
export function detectVpnProtocol(configText: string): 'openvpn' | 'wireguard' {
  const lower = configText.toLowerCase();
  if (lower.includes('[interface]') && lower.includes('privatekey')) {
    return 'wireguard';
  }
  // VPN Gate payloads are OpenVPN even when a row lacks the `client` keyword.
  const openVpnMarkers = lower.includes('<ca>') || PROTO_LINE.test(configText);
  return openVpnMarkers ? 'openvpn' : 'wireguard';
}

export interface RemoteEndpoint {
  port: number | null;
  transport: VpnTransport;
}

function readTransport(configText: string): VpnTransport {
  const match = PROTO_LINE.exec(configText);
  if (match === null) {
    return DEFAULT_VPN_GATE_TRANSPORT;
  }
  return match[1]!.toLowerCase().startsWith('tcp') ? 'tcp' : 'udp';
}

/** Extracts `remote <host> <port>` and the transport from the sanitized text. */
export function extractRemote(configText: string): RemoteEndpoint {
  const match = REMOTE_LINE.exec(configText);
  if (match === null) {
    return { port: null, transport: readTransport(configText) };
  }
  return { port: parseIntStrict(match[1]!), transport: readTransport(configText) };
}

/** Base64 with whitespace normalization, URL-safe alphabet tolerance, and
 * padding repair; null on any invalid input (never throws). */
export function decodeConfigBase64(encoded: string): string | null {
  const bytes = decodeBase64Tolerant(encoded);
  if (bytes === null) {
    return null;
  }
  return utf8DecodeTolerant(bytes);
}

/** Dart `int.tryParse` equivalent: optional sign, digits only, base 10. */
function parseIntStrict(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
