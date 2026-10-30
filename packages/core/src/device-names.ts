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
// Control characters except \t \n \v \f \r, which collapse to a space below.
const CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;

/** Trim, strip control characters, collapse whitespace, cap at 64 characters. */
export function sanitizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(CONTROLS, '').replace(/\s+/g, ' ').trim();
  // Slice by code point so a cut never leaves half a surrogate pair.
  const name = Array.from(clean).slice(0, NAME_MAX).join('').trim();
  return name || null;
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
  return (
    device.customName ||
    device.mdnsName ||
    device.friendlyName ||
    device.netbiosName ||
    device.hostname?.split('.')[0] ||
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
