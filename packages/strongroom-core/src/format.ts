import { sha256 } from '@noble/hashes/sha2.js';
import { KDF_DEFAULT, KDF_FLOOR, argon2id, hkdf, kdfInRange, kdfWeaker, open, randomBytes, seal, utf8 } from './crypto.ts';
import type { KdfParams } from './crypto.ts';
import { decodeEntry, encodeEntry } from './entry.ts';
import type { Entry } from './entry.ts';
import { generateRecoveryKey } from './recovery-key.ts';

export type Header = {
  version: number;
  kdf: KdfParams;
  salt: Uint8Array;
  passwordWrap: Uint8Array;
  recoveryWrap: Uint8Array;
  accountKey?: true;
};

export class KdfOutOfRange extends Error {
  kdf: KdfParams;
  constructor(kdf: KdfParams) {
    super('KDF parameters out of range');
    this.kdf = kdf;
  }
}

export class AccountKeyRequired extends Error {
  constructor() {
    super('This vault needs its account key');
  }
}

export type Options = { kdf?: KdfParams; floor?: KdfParams };
type AccountKeyOption = { accountKey?: Uint8Array };

const VERSION = 1;
const SALT_BYTES = 16;
const VAULT_KEY_BYTES = 32;
const ACCOUNT_KEY_BYTES = 20;
const MAX_HEADER_CHARS = 4096;
const ACCOUNT_LABEL = 'strongroom/v1/account';
const WRAP_LABEL = 'strongroom/v1/wrap';
const LOGIN_LABEL = 'strongroom/v1/login';
const READ_LABEL = 'strongroom/v1/read';
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
    accountKey: h.accountKey, // stringify drops undefined, so an unflagged header keeps its old bytes
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
    if (o.accountKey === true) h.accountKey = true;
    else if (o.accountKey !== undefined) return null;
    const ints = [h.version, memoryKiB, iterations, parallelism].every(Number.isInteger);
    return ints && h.version === VERSION && h.salt.length === SALT_BYTES ? h : null;
  } catch {
    return null; // a SyntaxError, a missing field or a bad type all mean "not a header"
  }
}

// One Argon2 run. An account key is mixed in before the split, so the wrap and both tokens need both secrets.
async function passwordKeys(password: string, salt: Uint8Array, kdf: KdfParams, accountKey?: Uint8Array) {
  if (accountKey && accountKey.length !== ACCOUNT_KEY_BYTES) throw new Error('An account key is 20 bytes');
  const argon = await argon2id(password, salt, kdf);
  const master = accountKey ? hkdf(argon, ACCOUNT_LABEL, 32, accountKey) : argon;
  return { wrapKey: hkdf(master, WRAP_LABEL), loginToken: hkdf(master, LOGIN_LABEL), readToken: hkdf(master, READ_LABEL) };
}

const sealPasswordWrap = async (password: string, salt: Uint8Array, kdf: KdfParams, vaultKey: Uint8Array, accountKey?: Uint8Array) =>
  seal((await passwordKeys(password, salt, kdf, accountKey)).wrapKey, vaultKey, PASSWORD_WRAP_AAD);

export async function createVault(
  password: string,
  recoveryKey: Uint8Array,
  { kdf = KDF_DEFAULT, floor = KDF_FLOOR, accountKey }: Options & AccountKeyOption = {},
): Promise<{ header: Header; vaultKey: Uint8Array }> {
  if (!kdfInRange(kdf, floor)) throw new KdfOutOfRange(kdf);
  const vaultKey = randomBytes(VAULT_KEY_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const header: Header = {
    version: VERSION,
    kdf,
    salt,
    passwordWrap: await sealPasswordWrap(password, salt, kdf, vaultKey, accountKey),
    recoveryWrap: await seal(hkdf(recoveryKey, WRAP_LABEL), vaultKey, RECOVERY_WRAP_AAD),
  };
  if (accountKey) header.accountKey = true;
  return { header, vaultKey };
}

// Takes a header or, on a new device's sign-in, prelogin's kdf, salt and flag: both refuse before the one Argon2 run.
export async function derivePasswordKeys(
  p: { kdf: KdfParams; salt: Uint8Array; accountKey?: boolean },
  password: string,
  floor: KdfParams = KDF_FLOOR,
  accountKey?: Uint8Array,
): Promise<{ wrapKey: Uint8Array; loginToken: Uint8Array; readToken: Uint8Array }> {
  if (!kdfInRange(p.kdf, floor)) throw new KdfOutOfRange(p.kdf);
  if (p.accountKey && !accountKey) throw new AccountKeyRequired();
  return passwordKeys(password, p.salt, p.kdf, accountKey);
}

export const openPasswordWrap = (h: Header, wrapKey: Uint8Array): Promise<Uint8Array | null> => open(wrapKey, h.passwordWrap, PASSWORD_WRAP_AAD);

export async function openWithPassword(
  h: Header,
  password: string,
  floor: KdfParams = KDF_FLOOR,
  accountKey?: Uint8Array,
): Promise<{ vaultKey: Uint8Array; loginToken: Uint8Array; readToken: Uint8Array } | null> {
  // A given key is mixed in even without the flag, so a header stripped of it opens nothing rather than falling back to the password alone.
  const { wrapKey, loginToken, readToken } = await derivePasswordKeys(h, password, floor, accountKey);
  const vaultKey = await openPasswordWrap(h, wrapKey);
  return vaultKey && { vaultKey, loginToken, readToken };
}

export async function unlockWithPassword(h: Header, password: string, floor: KdfParams = KDF_FLOOR, accountKey?: Uint8Array): Promise<Uint8Array | null> {
  return (await openWithPassword(h, password, floor, accountKey))?.vaultKey ?? null;
}

export const unlockWithRecovery = (h: Header, recoveryKey: Uint8Array): Promise<Uint8Array | null> =>
  open(hkdf(recoveryKey, WRAP_LABEL), h.recoveryWrap, RECOVERY_WRAP_AAD);

export const recoveryLoginToken = (recoveryKey: Uint8Array): Uint8Array => hkdf(recoveryKey, LOGIN_LABEL);

export const tokenHash = (token: Uint8Array): string => toBase64(sha256(token));

// Reseals recoveryWrap under a new recovery key; everything else in the header stays byte-identical.
export async function rotateRecoveryKey(
  h: Header,
  vaultKey: Uint8Array,
): Promise<{ header: Header; recoveryKey: Uint8Array; recoveryHash: string }> {
  const recoveryKey = generateRecoveryKey();
  const recoveryWrap = await seal(hkdf(recoveryKey, WRAP_LABEL), vaultKey, RECOVERY_WRAP_AAD);
  return { header: { ...h, recoveryWrap }, recoveryKey, recoveryHash: tokenHash(recoveryLoginToken(recoveryKey)) };
}

export async function withNewPassword(
  h: Header,
  vaultKey: Uint8Array,
  password: string,
  { kdf = h.kdf, floor = KDF_FLOOR, accountKey }: Options & AccountKeyOption = {},
): Promise<Header> {
  if (!kdfInRange(kdf, floor) || kdfWeaker(kdf, h.kdf)) throw new KdfOutOfRange(kdf);
  if (h.accountKey && !accountKey) throw new AccountKeyRequired();
  const salt = randomBytes(SALT_BYTES);
  const next: Header = { ...h, kdf, salt, passwordWrap: await sealPasswordWrap(password, salt, kdf, vaultKey, accountKey) };
  if (accountKey) next.accountKey = true;
  return next;
}

export const withAccountKey = (
  h: Header,
  vaultKey: Uint8Array,
  password: string,
  accountKey: Uint8Array,
  { floor = KDF_FLOOR }: Pick<Options, 'floor'> = {},
): Promise<Header> => withNewPassword(h, vaultKey, password, { floor, accountKey });

// The record id is bound into the AAD, so a record's ciphertext can't be replayed under another id.
const recordAad = (id: string): Uint8Array => utf8(`strongroom/v1/record/${id}`);

export const sealEntry = (vaultKey: Uint8Array, id: string, e: Entry): Promise<Uint8Array> =>
  seal(vaultKey, utf8(encodeEntry(e)), recordAad(id));

export async function openEntry(vaultKey: Uint8Array, id: string, sealed: Uint8Array): Promise<Entry | null> {
  const plain = await open(vaultKey, sealed, recordAad(id));
  return plain && decodeEntry(new TextDecoder().decode(plain));
}
