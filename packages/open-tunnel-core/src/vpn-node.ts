/**
 * Immutable VPN Gate relay candidate model.
 * 1:1 port of `lib/core/models/vpn_node.dart` — identity is the sha256 of
 * `ip:port` (the probe endpoint), never the rotating host name.
 */
import { sha256Hex } from './sha256.ts';

/** Tunnel payload protocol served by a node. VPN Gate column 15 (index 14)
 * is always OpenVPN data; `wireguard` only ever occurs for genuine `.conf`
 * imports. Detect from the payload, never from the endpoint name. */
export type VpnProtocol = 'openvpn' | 'wireguard';

/** Underlying transport advertised in a node's OpenVPN config. */
export type VpnTransport = 'tcp' | 'udp';

export interface VpnNode {
  /** Lowercase hex sha256 of `$ip:$port`. */
  readonly id: string;
  readonly hostName: string;
  /** Stable probe address from the CSV IP column. */
  readonly ip: string;
  readonly port: number;
  readonly transportProto: VpnTransport;
  /** Upstream heuristic score from the VPN Gate API. */
  readonly score: number;
  readonly pingMs: number;
  readonly speedBps: number;
  readonly countryLong: string;
  readonly countryShort: string;
  readonly numSessions: number;
  /** Milliseconds; upstream reports seconds. */
  readonly uptimeMs: number;
  readonly operatorName: string;
  /** Sanitized OpenVPN text; never log or ship it remotely. */
  readonly ovpnConfigRaw: string;
  readonly protocol: VpnProtocol;
  /** Measured TCP handshake RTT (ms), or null when the probe failed. */
  readonly measuredRttMs: number | null;
  /** Composite fitness score, filled by the latency prober. */
  readonly fitnessScore: number;
}

export interface VpnNodeInput {
  hostName: string;
  ip: string;
  port: number;
  transportProto: VpnTransport;
  score: number;
  pingMs: number;
  speedBps: number;
  countryLong: string;
  countryShort: string;
  numSessions: number;
  uptimeMs: number;
  operatorName: string;
  ovpnConfigRaw: string;
  protocol?: VpnProtocol;
}

/** Stable node identifier derived from the probe endpoint. */
export function vpnNodeIdFor(ip: string, port: number): string {
  return sha256Hex(`${ip}:${port}`);
}

/** Builds a node with its id derived from the probe endpoint. */
export function createVpnNode(input: VpnNodeInput): VpnNode {
  return Object.freeze({
    id: vpnNodeIdFor(input.ip, input.port),
    hostName: input.hostName,
    ip: input.ip,
    port: input.port,
    transportProto: input.transportProto,
    score: input.score,
    pingMs: input.pingMs,
    speedBps: input.speedBps,
    countryLong: input.countryLong,
    countryShort: input.countryShort,
    numSessions: input.numSessions,
    uptimeMs: input.uptimeMs,
    operatorName: input.operatorName,
    ovpnConfigRaw: input.ovpnConfigRaw,
    protocol: input.protocol ?? 'openvpn',
    measuredRttMs: null,
    fitnessScore: 0,
  });
}

/** Applies probe results as a fresh object; the input node is never mutated. */
export function withProbe(
  node: VpnNode,
  probe: Partial<Pick<VpnNode, 'measuredRttMs' | 'fitnessScore'>>,
): VpnNode {
  return Object.freeze({
    ...node,
    measuredRttMs: probe.measuredRttMs ?? node.measuredRttMs,
    fitnessScore: probe.fitnessScore ?? node.fitnessScore,
  });
}

/** MHz-equivalent convenience: the CSV Speed column is bits/s. */
export function speedMbps(node: VpnNode): number {
  return node.speedBps / 1000000;
}

export function uptimeSec(node: VpnNode): number {
  return Math.floor(node.uptimeMs / 1000);
}

/** Short, non-sensitive diagnostics label. */
export function nodeLabel(node: VpnNode): string {
  return `${node.countryShort}/${node.hostName}:${node.port}`;
}

/** Identity equality: same probe endpoint means same node. */
export function nodeEquals(a: VpnNode, b: VpnNode): boolean {
  return a.id === b.id;
}
