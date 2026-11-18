import { formatIpv4, parseIpv4, prefixToMask } from './ipv4.ts';

/** `AA:BB:CC:DD:EE:FF` from a MAC written with `:`, `-` or no separator (one kind only), any case; else null. */
export function parseMac(input: string): string | null {
  const s = input.trim();
  const m = /^[0-9a-f]{12}$/i.test(s) ? s.match(/../g) : /^[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}$/i.test(s) ? s.split(/[:-]/) : null;
  return m ? m.join(':').toUpperCase() : null;
}

/** 6 x 0xFF then the MAC 16 times (102 bytes). Throws on an invalid, all-zero or all-FF MAC: a wrong packet must never be sent. */
export function magicPacket(mac: string): number[] {
  const parsed = parseMac(mac);
  if (!parsed) throw new RangeError(`Not a MAC address: ${mac}`);
  if (/^(00|FF)(:\1){5}$/.test(parsed)) throw new RangeError(`Not a device MAC: ${mac}`);
  const bytes = parsed.split(':').map((h) => parseInt(h, 16));
  return [...Array<number>(6).fill(0xff), ...Array.from({ length: 16 }, () => bytes).flat()];
}

/** Directed broadcast address of the subnet holding `localIp`. Throws on a bad IP or a prefix outside 0..32. */
export function subnetBroadcast(localIp: string, prefix: number): string {
  const ip = parseIpv4(localIp);
  if (ip === null) throw new RangeError(`Not an IPv4 address: ${localIp}`);
  return formatIpv4((ip | ~prefixToMask(prefix)) >>> 0);
}
