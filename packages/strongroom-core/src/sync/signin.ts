import { derivePasswordKeys, fromBase64, headerFromJson, openPasswordWrap, recoveryLoginToken, toBase64, unlockWithRecovery } from '../format.ts';
import type { Header } from '../format.ts';
import type { Prelogin } from './protocol.ts';
import { pullAll, SyncAuthError, SyncHttpError } from './transport.ts';
import type { Transport } from './transport.ts';

// Sign-in writes nothing: the caller commits the result in one write, so a failed sign-in leaves the old vault as it was.
export type SignedIn = {
  header: Header;
  headerRev: number;
  records: { id: string; sealed: Uint8Array; rev: number }[];
  lastRev: number;
  vaultKey: Uint8Array;
  loginToken: Uint8Array;
  readToken: Uint8Array | null;
};

async function download(t: Transport, token: Uint8Array) {
  const p = await pullAll(t, token, 0);
  const header = headerFromJson(p.header);
  if (!header) throw new SyncAuthError();
  const records = p.rows.flatMap((r) => (r.sealed ? [{ id: r.id, sealed: r.sealed, rev: r.rev }] : []));
  return { header, headerRev: p.headerRev, records, lastRev: p.latestRev };
}

// The keys came from prelogin, so a header with other settings would not open on this device's next unlock.
const matches = (h: Header, p: Prelogin) =>
  h.kdf.memoryKiB === p.kdf.memoryKiB && h.kdf.iterations === p.kdf.iterations && h.kdf.parallelism === p.kdf.parallelism &&
  toBase64(h.salt) === p.salt && (h.accountKey === true) === p.accountKey;

export async function signInWithPassword(t: Transport, password: string, accountKey?: Uint8Array): Promise<SignedIn> {
  const pre = await t.prelogin();
  if (!pre) throw new SyncHttpError(404, 'No sync account exists yet. Turn on sync on the phone first.');
  const keys = await derivePasswordKeys({ kdf: pre.kdf, salt: fromBase64(pre.salt), accountKey: pre.accountKey }, password, undefined, accountKey);
  const got = await download(t, keys.loginToken);
  const vaultKey = matches(got.header, pre) ? await openPasswordWrap(got.header, keys.wrapKey) : null;
  if (!vaultKey) throw new SyncAuthError();
  return { ...got, vaultKey, loginToken: keys.loginToken, readToken: keys.readToken };
}

export async function signInWithRecovery(t: Transport, recoveryKey: Uint8Array): Promise<SignedIn> {
  const loginToken = recoveryLoginToken(recoveryKey);
  const got = await download(t, loginToken);
  const vaultKey = await unlockWithRecovery(got.header, recoveryKey);
  if (!vaultKey) throw new SyncAuthError();
  return { ...got, vaultKey, loginToken, readToken: null };
}
