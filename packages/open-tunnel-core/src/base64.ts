/**
 * Whitespace-tolerant base64 decoding and malformed-tolerant UTF-8 text
 * decoding, both written against Hermes (no Buffer, no TextDecoder).
 * Ports the Dart-side `base64Decode` + `utf8.decode(..., allowMalformed: true)`
 * behavior used by the VPN Gate config column.
 */

const REV: Int8Array = buildReverseTable();

function buildReverseTable(): Int8Array {
  const table = new Int8Array(128).fill(-1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i++) {
    table[chars.charCodeAt(i)] = i;
  }
  return table;
}

/**
 * Decodes base64 (with optional padding, URL-safe alphabet accepted,
 * whitespace anywhere) into raw bytes, or returns null on invalid input —
 * identical rejection rules to the Dart `_decodeConfigBase64` helper:
 * - a remainder of 1 (impossible 6-bit) rejects,
 * - padding is repaired before validation,
 * - characters outside the standard alphabet reject.
 */
export function decodeBase64Tolerant(input: string): Uint8Array | null {
  let normalized = '';
  for (const ch of input) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch === '-') {
      normalized += '+';
    } else if (ch === '_') {
      normalized += '/';
    } else {
      normalized += ch;
    }
  }
  // Strip trailing '=' first so the length check below sees payload length.
  while (normalized.endsWith('=')) {
    normalized = normalized.slice(0, -1);
  }
  const rest = normalized.length % 4;
  if (rest === 1) return null; // 6-bit remainder cannot represent full bytes

  const out = new Uint8Array(Math.floor(normalized.length / 4) * 3 + (rest ? rest - 1 : 0));
  let outLen = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code > 127) return null;
    const value = REV[code];
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outLen++] = (buffer >>> bits) & 0xff;
    }
  }
  return out.subarray(0, outLen);
}

/** Malformed-tolerant UTF-8 decode: invalid sequences become U+FFFD. */
export function utf8DecodeTolerant(bytes: Uint8Array): string {
  let text = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 === undefined) break;
    if (b0 < 0x80) {
      text += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    let seqLength = 0;
    let codePoint = 0;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      seqLength = 2;
      codePoint = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      seqLength = 3;
      codePoint = b0 & 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      seqLength = 4;
      codePoint = b0 & 0x07;
    }
    let jumped = false;
    if (seqLength === 0 || i + seqLength > bytes.length) jumped = true;
    if (!jumped) {
      for (let k = 1; k < seqLength; k++) {
        const b = bytes[i + k];
        if (b === undefined || (b & 0xc0) !== 0x80) {
          jumped = true;
          break;
        }
        codePoint = (codePoint << 6) | (b & 0x3f);
      }
    }
    if (jumped || !validSequence(b0, codePoint)) {
      // Emit replacement and re-test the offending byte next iteration.
      text += '\uFFFD';
      i += 1;
      continue;
    }
    text += fromCodePoint(codePoint);
    i += seqLength;
  }
  return text;
}

function validSequence(b0: number, cp: number): boolean {
  if (b0 >= 0xc2 && b0 <= 0xdf) return true;
  if (b0 >= 0xe0 && b0 <= 0xef) return cp >= 0x800; // rejects overlong 3-byte
  if (b0 >= 0xf0 && b0 <= 0xf4) return cp >= 0x10000 && cp <= 0x10ffff;
  return false;
}

/** Emits code points above the BMP as surrogate pairs. */
function fromCodePoint(cp: number): string {
  if (cp <= 0xffff) return String.fromCharCode(cp);
  const off = cp - 0x10000;
  return String.fromCharCode(0xd800 + (off >>> 10), 0xdc00 + (off & 0x3ff));
}
