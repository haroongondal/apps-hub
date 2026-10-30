/**
 * Device name rules: how raw network text becomes a safe name, which name a
 * device shows, and how fresh names merge into a stored row. Pure TypeScript.
 * Order shown: custom, mDNS, SSDP friendlyName, NetBIOS, hostname, model, IP.
 */
import type { StoredDevice } from './device-repository.ts';
import { parseIpv4 } from './ipv4.ts';

export interface DeviceNames {
  hostname: string | null;
  mdnsName: string | null;
  friendlyName: string | null;
  model: string | null;
  netbiosName: string | null;
}

const NAME_MAX = 64;
// Control characters except \t \n \v \f \r (collapsed to a space below), plus
// the bidi embedding/override/isolate characters that can reorder UI text.
// ZWJ, ZWNJ, LRM and RLM stay: real names need them.
const CONTROLS =
  /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
// A name with none of these left is blank to the eye, so it counts as no name.
const VISIBLE = /[^\s\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/;

/** Trim, strip control characters, collapse whitespace, cap at 64 characters. */
export function sanitizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(CONTROLS, '').replace(/\s+/g, ' ').trim();
  // Slice by code point so a cut never leaves half a surrogate pair.
  const name = Array.from(clean).slice(0, NAME_MAX).join('').trim();
  return VISIBLE.test(name) ? name : null;
}

/** AirPlay-style instances start with a MAC (`A1B2C3D4E5F6@Name`); drop it. */
export function cleanMdnsInstanceName(raw: string): string | null {
  return sanitizeName(raw.replace(/^[0-9A-F]{12}@/, ''));
}

/** 10/8, 172.16/12, 192.168/16 and link-local 169.254/16. */
export function isPrivateIpv4(ip: string): boolean {
  const value = parseIpv4(ip);
  if (value === null) return false;
  const a = value >>> 24;
  const b = (value >>> 16) & 0xff;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function displayNameFor(device: StoredDevice): string {
  // An IP-literal hostname has no useful first label ("192" of 192.168.1.5).
  const hostLabel =
    device.hostname && parseIpv4(device.hostname) === null
      ? device.hostname.split('.')[0]
      : null;
  return (
    device.customName ||
    device.mdnsName ||
    device.friendlyName ||
    device.netbiosName ||
    hostLabel ||
    device.vendorOrModel ||
    device.lastIp
  );
}

/** Callers pass clean names; null keeps the stored value. Identity is untouched. */
export function applyDeviceNames(
  device: StoredDevice,
  names: DeviceNames,
): StoredDevice {
  return {
    ...device,
    hostname: names.hostname ?? device.hostname,
    mdnsName: names.mdnsName ?? device.mdnsName,
    friendlyName: names.friendlyName ?? device.friendlyName,
    model: names.model ?? device.model,
    netbiosName: names.netbiosName ?? device.netbiosName,
  };
}
