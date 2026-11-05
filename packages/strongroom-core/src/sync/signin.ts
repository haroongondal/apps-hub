import { derivePasswordKeys, fromBase64, headerFromJson, openEntry, openPasswordWrap, recoveryLoginToken, toBase64, unlockWithRecovery } from '../format.ts';
import type { Header } from '../format.ts';
import type { Prelogin } from './protocol.ts';
import { pullAll, SyncAuthError, SyncHttpError } from './transport.ts';
import type { Pulled, Transport } from './transport.ts';

type Row = { id: string; sealed: Uint8Array; rev: number };

// Sign-in writes nothing: the caller commits the result in one write (quarantine through applyPull, as syncOnce does), so a failed sign-in leaves the old vault as it was.
export type SignedIn = {
  header: Header;
  headerRev: number;
  records: Row[];
  quarantine: Row[];
  skipped: number;
  lastRev: number;
  vaultKey: Uint8Array;
  loginToken: Uint8Array;
  readToken: Uint8Array | null;
};

async function download(t: Transport, token: Uint8Array): Promise<{ p: Pulled; header: Header }> {
  const p = await pullAll(t, token, 0);
  const header = headerFromJson(p.header);
  if (!header) throw new SyncAuthError();
  return { p, header };
}

// Rows that don't decrypt are quarantined, never stored as records; rows with no usable bytes (bad id, oversize, not base64) are only counted.
async function signedIn(p: Pulled, header: Header, vaultKey: Uint8Array, loginToken: Uint8Array, readToken: Uint8Array | null): Promise<SignedIn> {
  const records: Row[] = [];
  const quarantine: Row[] = [];
  let skipped = p.skipped;
  for (const { id, rev, sealed } of p.rows) {
    if (!sealed) skipped++;
    else ((await openEntry(vaultKey, id, sealed)) ? records : quarantine).push({ id, sealed, rev });
  }
  return { header, headerRev: p.headerRev, records, quarantine, skipped, lastRev: p.latestRev, vaultKey, loginToken, readToken };
}

const matches = (h: Header, p: Prelogin) =>
  h.kdf.memoryKiB === p.kdf.memoryKiB && h.kdf.iterations === p.kdf.iterations && h.kdf.parallelism === p.kdf.parallelism &&
  toBase64(h.salt) === p.salt && (h.accountKey === true) === p.accountKey;

export async function signInWithPassword(t: Transport, password: string, accountKey?: Uint8Array): Promise<SignedIn> {
  const pre = await t.prelogin();
  if (!pre) throw new SyncHttpError(404, 'No sync account exists yet. Turn on sync on the phone first.');
  const keys = await derivePasswordKeys({ kdf: pre.kdf, salt: fromBase64(pre.salt), accountKey: pre.accountKey }, password, undefined, accountKey);
  const { p, header } = await download(t, keys.loginToken);
  // The keys came from prelogin, so a header with other settings would not open on this device's next unlock.
  const vaultKey = matches(header, pre) ? await openPasswordWrap(header, keys.wrapKey) : null;
  if (!vaultKey) throw new SyncAuthError();
  return signedIn(p, header, vaultKey, keys.loginToken, keys.readToken);
}

export async function signInWithRecovery(t: Transport, recoveryKey: Uint8Array): Promise<SignedIn> {
  const loginToken = recoveryLoginToken(recoveryKey);
  const { p, header } = await download(t, loginToken);
  const vaultKey = await unlockWithRecovery(header, recoveryKey);
  if (!vaultKey) throw new SyncAuthError();
  return signedIn(p, header, vaultKey, loginToken, null);
}
