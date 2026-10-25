/**
 * Subnet planning for the LAN sweep.
 *
 * NFR-1: the full scan must never exceed a /24 (254 probes) around the
 * device's host IP, so any requested prefix is CLAMPED to the containing /24:
 *  - /16, /8, /0 → widened to the containing /24 (prevents /16-style stalls)
 *  - /25../32    → widened to the containing /24 (keeps the same bounded window)
 *  - /24         → used as-is
 * The network (…0) and broadcast (…255) addresses are always excluded.
 */
import { formatIpv4, parseIpv4, prefixToMask } from './ipv4.ts';

export interface SubnetPlan {
  hostIp: string;
  /** The raw prefix as requested (before clamping). */
  requestedPrefix: number;
  /** Effective prefix — always 24 after clamping. */
  prefix: number;
  /** True when `requestedPrefix` was not already 24. */
  clamped: boolean;
  /** Network address (all-zero host part) — excluded from the sweep. */
  networkIp: string;
  /** Broadcast address (all-ones host part) — excluded from the sweep. */
  broadcastIp: string;
  /** Target list in ascending order, including the host IP itself. */
  hosts: string[];
}

/** Maximum /24 window enforced around the host IP. */
export const MAX_SWEEP_PREFIX = 24;

/**
 * Clamp any requested CIDR prefix to the containing /24 of `hostIp`.
 * Every non-24 request becomes the containing /24 (0..32 validated).
 */
export function computeClampedPrefix(requestedPrefix: number): {
  prefix: number;
  clamped: boolean;
} {
  if (!Number.isInteger(requestedPrefix) || requestedPrefix < 0 || requestedPrefix > 32) {
    throw new RangeError(`CIDR prefix out of range 0..32: ${requestedPrefix}`);
  }
  return { prefix: MAX_SWEEP_PREFIX, clamped: requestedPrefix !== MAX_SWEEP_PREFIX };
}

/**
 * Build the full sweep plan for a host IP + requested CIDR prefix.
 * Throws TypeError on malformed IPs and RangeError on invalid prefixes.
 */
export function computeSubnetForHost(hostIp: string, requestedPrefix: number): SubnetPlan {
  const host = parseIpv4(hostIp);
  if (host === null) {
    throw new TypeError(`Invalid IPv4 address: ${JSON.stringify(hostIp)}`);
  }
  const { prefix, clamped } = computeClampedPrefix(requestedPrefix);
  const mask = prefixToMask(prefix);
  const network = (host & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  const hosts: string[] = [];
  // Exclude network (first) and broadcast (last) addresses of the window.
  for (let addr = network + 1; addr < broadcast; addr += 1) {
    hosts.push(formatIpv4(addr >>> 0));
  }

  return {
    hostIp: formatIpv4(host),
    requestedPrefix,
    prefix,
    clamped,
    networkIp: formatIpv4(network),
    broadcastIp: formatIpv4(broadcast),
    hosts,
  };
}
