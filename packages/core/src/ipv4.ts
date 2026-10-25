/**
 * IPv4 addresses as unsigned 32-bit integers.
 * Pure TS — no platform dependencies (runs under Metro, Electron, or Node).
 */

/**
 * Parse a dotted-quad IPv4 string into a uint32. Returns `null` on malformed input.
 * Accepts up to 3 digits per octet (leading zeros allowed). Rejects whitespace,
 * signs, and values > 255.
 */
export function parseIpv4(input: string): number | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // ASCII digits only: \d matches [0-9] without the unicode flag.
    if (!/^\d+$/.test(part) || part.length > 3) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256 + octet) >>> 0;
  }
  return value >>> 0;
}

/**
 * Format a uint32 as dotted-quad IPv4. Throws on out-of-range input.
 */
export function formatIpv4(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`Not a 32-bit unsigned value: ${value}`);
  }
  const v = value >>> 0;
  return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`;
}

/** Unsigned 32-bit prefix-length mask (0..32). */
export function prefixToMask(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`CIDR prefix out of range 0..32: ${prefix}`);
  }
  if (prefix === 0) return 0;
  if (prefix === 32) return 0xffffffff;
  return (~0 << (32 - prefix)) >>> 0;
}
