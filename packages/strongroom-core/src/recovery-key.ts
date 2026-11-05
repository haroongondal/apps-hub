import { randomBytes } from './crypto.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BYTES = 20;
const CHARS = 32;

export const generateRecoveryKey = (): Uint8Array => randomBytes(BYTES);

/** Base32 in eight groups of four: `ABCD-EFGH-…`. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length !== BYTES) throw new Error('A recovery key is 20 bytes');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Tolerates case, dashes and whitespace; null for a wrong length or a character outside the alphabet. */
export function parseRecoveryKey(text: string): Uint8Array | null {
  const chars = text.replace(/[-\s]/g, '').toUpperCase();
  if (chars.length !== CHARS) return null;
  const out = new Uint8Array(BYTES);
  let buffer = 0;
  let bits = 0;
  let next = 0;
  for (const c of chars) {
    const value = ALPHABET.indexOf(c);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[next++] = (buffer >> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

export const recoveryKeyGroup = (formatted: string, index: number): string => formatted.split('-')[index];
