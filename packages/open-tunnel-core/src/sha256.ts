/**
 * Pure-TS SHA-256 (FIPS 180-4). Deliberately dependency-free:
 * Hermes (React Native) ships no `node:crypto` and no @noble dep is allowed
 * here, and the same digest must run in Node tests, Electron, and RN.
 *
 * Returns lowercase hex — byte-identical to `sha256.convert(...).toString()`
 * from the Dart `crypto` package this suite replaced.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX: readonly string[] = [
  '0', '1', '2', '3', '4', '5', '6', '7',
  '8', '9', 'a', 'b', 'c', 'd', 'e', 'f',
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Consumes one 64-byte big-endian block, updating the state. */
function compress(state: Uint32Array, block: Uint8Array): void {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    const j = i * 4;
    w[i] =
      ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }

  let [a, b, c, d, e, f, g, h] = state;
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const mj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + mj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0;
  state[5] = (state[5] + f) >>> 0;
  state[6] = (state[6] + g) >>> 0;
  state[7] = (state[7] + h) >>> 0;
}

/** Streaming-friendly incremental SHA-256. */
export class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  private byteCount = 0;

  update(bytes: Uint8Array): this {
    let offset = 0;
    this.byteCount += bytes.length;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, bytes.length);
      this.block.set(bytes.subarray(0, take), this.blockLen);
      this.blockLen += take;
      offset = take;
      if (this.blockLen === 64) {
        compress(this.state, this.block);
        this.blockLen = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      compress(this.state, bytes.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLen = bytes.length - offset;
    }
    return this;
  }

  finish(): Uint8Array {
    const bitsHi = Math.floor(this.byteCount / 536870912) >>> 0; // byteCount * 8 / 2^32
    const bitsLo = (this.byteCount << 3) >>> 0;

    // Padding: exactly enough bytes to reach the next block boundary,
    // starting with 0x80, then zeros, ending with the 8-byte big-endian bit
    // length. Never sizes to a bare 64 — the remainder must exactly fill the
    // current block (or two blocks, when fewer than 9 bytes remain).
    const padLen = this.blockLen < 56 ? 64 - this.blockLen : 128 - this.blockLen;
    const padding = new Uint8Array(padLen);
    padding[0] = 0x80; // everything else zeroed by allocation
    const len = padding.length;
    padding.set(
      [
        (bitsHi >>> 24) & 0xff, (bitsHi >>> 16) & 0xff, (bitsHi >>> 8) & 0xff, bitsHi & 0xff,
        (bitsLo >>> 24) & 0xff, (bitsLo >>> 16) & 0xff, (bitsLo >>> 8) & 0xff, bitsLo & 0xff,
      ],
      len - 8,
    );

    this.update(padding);

    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const v = this.state[i] >>> 0;
      out[i * 4] = (v >>> 24) & 0xff;
      out[i * 4 + 1] = (v >>> 16) & 0xff;
      out[i * 4 + 2] = (v >>> 8) & 0xff;
      out[i * 4 + 3] = v & 0xff;
    }
    return out;
  }
}

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return new Sha256().update(bytes).finish();
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256Bytes(utf8Encode(text)));
}

/** UTF-8 encode without TextEncoder (Hermes has no global TextEncoder). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp <= 0x7f) {
      out.push(cp);
    } else if (cp <= 0x7ff) {
      out.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      out.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 0x3f),
        0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += HEX[(b & 0xf0) >>> 4] + HEX[b & 0x0f];
  }
  return hex;
}
