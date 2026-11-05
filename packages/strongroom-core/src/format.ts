import { KDF_DEFAULT, KDF_FLOOR, argon2id, hkdf, kdfInRange, open, randomBytes, seal, utf8 } from './crypto.ts';
import type { KdfParams } from './crypto.ts';
import { decodeEntry, encodeEntry } from './entry.ts';
import type { Entry } from './entry.ts';

export type Header = {
  version: number;
  kdf: KdfParams;
  salt: Uint8Array;
  passwordWrap: Uint8Array;
  recoveryWrap: Uint8Array;
};

export class KdfOutOfRange extends Error {
  kdf: KdfParams;
  constructor(kdf: KdfParams) {
    super('KDF parameters out of range');
    this.kdf = kdf;
  }
}

export type Options = { kdf?: KdfParams; floor?: KdfParams };

const VERSION = 1;
const SALT_BYTES = 16;
const VAULT_KEY_BYTES = 32;
const MAX_HEADER_CHARS = 4096;
const WRAP_LABEL = 'strongroom/v1/wrap';
const PASSWORD_WRAP_AAD = utf8('strongroom/v1/password-wrap');
const RECOVERY_WRAP_AAD = utf8('strongroom/v1/recovery-wrap');

export const toBase64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));

export function fromBase64(s: string): Uint8Array {
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new SyntaxError('bad base64');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export const headerToJson = (h: Header): string =>
  JSON.stringify({
    version: h.version,
    kdf: { memoryKiB: h.kdf.memoryKiB, iterations: h.kdf.iterations, parallelism: h.kdf.parallelism },
    salt: toBase64(h.salt),
    passwordWrap: toBase64(h.passwordWrap),
    recoveryWrap: toBase64(h.recoveryWrap),
  });

export function headerFromJson(text: string): Header | null {
  if (text.length > MAX_HEADER_CHARS) return null;
  try {
    const o = JSON.parse(text);
    const { memoryKiB, iterations, parallelism } = o.kdf;
    const h: Header = {
      version: o.version,
      kdf: { memoryKiB, iterations, parallelism },
      salt: fromBase64(o.salt),
      passwordWrap: fromBase64(o.passwordWrap),
      recoveryWrap: fromBase64(o.recoveryWrap),
    };
    const ints = [h.version, memoryKiB, iterations, parallelism].every(Number.isInteger);
    return ints && h.version === VERSION && h.salt.length === SALT_BYTES ? h : null;
  } catch {
    return null; // a SyntaxError, a missing field or a bad type all mean "not a header"
  }
}

async function passwordWrapKey(password: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  return hkdf(await argon2id(password, salt, kdf), WRAP_LABEL);
}

export async function createVault(
  password: string,
  recoveryKey: Uint8Array,
  { kdf = KDF_DEFAULT, floor = KDF_FLOOR }: Options = {},
): Promise<{ header: Header; vaultKey: Uint8Array }> {
  if (!kdfInRange(kdf, floor)) throw new KdfOutOfRange(kdf);
  const vaultKey = randomBytes(VAULT_KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const header: Header = {
    version: VERSION,
    kdf,
    salt,
    passwordWrap: await seal(await passwordWrapKey(password, salt, kdf), vaultKey, PASSWORD_WRAP_AAD),
    recoveryWrap: await seal(hkdf(recoveryKey, WRAP_LABEL), vaultKey, RECOVERY_WRAP_AAD),
  };
  return { header, vaultKey };
}

export async function unlockWithPassword(h: Header, password: string, floor: KdfParams = KDF_FLOOR): Promise<Uint8Array | null> {
  if (!kdfInRange(h.kdf, floor)) throw new KdfOutOfRange(h.kdf);
  return open(await passwordWrapKey(password, h.salt, h.kdf), h.passwordWrap, PASSWORD_WRAP_AAD);
}

export const unlockWithRecovery = (h: Header, recoveryKey: Uint8Array): Promise<Uint8Array | null> =>
  open(hkdf(recoveryKey, WRAP_LABEL), h.recoveryWrap, RECOVERY_WRAP_AAD);

export async function withNewPassword(h: Header, vaultKey: Uint8Array, password: string, { kdf = h.kdf, floor = KDF_FLOOR }: Options = {}): Promise<Header> {
  const weaker = kdf.memoryKiB < h.kdf.memoryKiB || kdf.iterations < h.kdf.iterations || kdf.parallelism < h.kdf.parallelism;
  if (!kdfInRange(kdf, floor) || weaker) throw new KdfOutOfRange(kdf);
  const salt = randomBytes(SALT_BYTES);
  return { ...h, kdf, salt, passwordWrap: await seal(await passwordWrapKey(password, salt, kdf), vaultKey, PASSWORD_WRAP_AAD) };
}

// The record id is bound into the AAD, so a record's ciphertext can't be replayed under another id.
const recordAad = (id: string): Uint8Array => utf8(`strongroom/v1/record/${id}`);

export const sealEntry = (vaultKey: Uint8Array, id: string, e: Entry): Promise<Uint8Array> =>
  seal(vaultKey, utf8(encodeEntry(e)), recordAad(id));

export async function openEntry(vaultKey: Uint8Array, id: string, sealed: Uint8Array): Promise<Entry | null> {
  const plain = await open(vaultKey, sealed, recordAad(id));
  return plain && decodeEntry(new TextDecoder().decode(plain));
}
