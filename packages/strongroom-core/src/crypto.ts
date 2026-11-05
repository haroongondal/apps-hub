import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export type KdfParams = { memoryKiB: number; iterations: number; parallelism: number };

export const KDF_DEFAULT: KdfParams = { memoryKiB: 65536, iterations: 3, parallelism: 1 };
export const KDF_FLOOR: KdfParams = { memoryKiB: 32768, iterations: 2, parallelism: 1 };
const KDF_MAX: KdfParams = { memoryKiB: 1048576, iterations: 16, parallelism: 4 };

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function kdfInRange(k: KdfParams, floor: KdfParams = KDF_FLOOR): boolean {
  const ints = [k.memoryKiB, k.iterations, k.parallelism].every(Number.isInteger);
  return (
    ints &&
    k.memoryKiB >= floor.memoryKiB && k.iterations >= floor.iterations && k.parallelism >= floor.parallelism &&
    k.memoryKiB <= KDF_MAX.memoryKiB && k.iterations <= KDF_MAX.iterations && k.parallelism <= KDF_MAX.parallelism
  );
}

// TextEncoder turns an unpaired surrogate into U+FFFD, exactly as the Android app does, so both derive the same bytes.
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export async function argon2id(password: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  const bytes = utf8(password.normalize('NFC'));
  try {
    return await argon2idAsync(bytes, salt, { t: kdf.iterations, m: kdf.memoryKiB, p: kdf.parallelism, dkLen: 32, asyncTick: 10 });
  } finally {
    bytes.fill(0);
  }
}

export const hkdf = (ikm: Uint8Array, info: string, length = 32): Uint8Array =>
  nobleHkdf(sha256, ikm, undefined, utf8(info), length);

const aesKey = (raw: Uint8Array, use: 'encrypt' | 'decrypt') =>
  crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [use]);

// Sealed layout is nonce(12) || ciphertext || tag(16), the same as the Android app; open returns null on any failure.
export async function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(NONCE_BYTES);
  const params = { name: 'AES-GCM', iv, additionalData: new Uint8Array(aad), tagLength: TAG_BYTES * 8 };
  const sealed = new Uint8Array(await crypto.subtle.encrypt(params, await aesKey(key, 'encrypt'), new Uint8Array(plaintext)));
  return Uint8Array.from([...iv, ...sealed]);
}

export async function open(key: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) return null;
  const params = { name: 'AES-GCM', iv: new Uint8Array(sealed.slice(0, NONCE_BYTES)), additionalData: new Uint8Array(aad), tagLength: TAG_BYTES * 8 };
  try {
    return new Uint8Array(await crypto.subtle.decrypt(params, await aesKey(key, 'decrypt'), new Uint8Array(sealed.slice(NONCE_BYTES))));
  } catch {
    return null;
  }
}
