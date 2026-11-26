import {
  AccountKeyRequired, FLAG_PREFIX, ImportError, KdfOutOfRange, SyncAuthError, SyncHttpError, SyncOfflineError, SyncRollbackError, adoptHeader,
  equalBytes, exportForChrome, formatEmailCode, fromBase64, formatRecoveryKey, generateEmailCode, headerFromJson, headerToJson, kdfWeaker, matches,
  newId, open, openEntry, openEscrow, openSignin, openWithPassword, parseAccountKey, parseEmailCode, parseGoogleExport, parseRecoveryKey, parseTotp, randomBytes, readEntries,
  recoveryKeyGroup, recoveryLoginToken, recover, registrableDomain, rotateRecoveryKey, seal, sealEscrow, sealSignin, setupVault, signInWithPassword,
  signInWithRecovery, siteFromUrl, syncOnce, toBase64, tokenHash, totpState, unlockWithRecovery, utf8, withNewPassword, writeEntries,
} from 'strongroom-core';
import type { Entry, Header, KdfParams, Login, RecordStore, Site, SignedIn, SyncReport, SyncStore, TotpState, Transport } from 'strongroom-core';
import { COMMON_PASSWORDS } from './common-passwords.ts';
import type { DeviceVault } from './device-vault.ts';

export type KV = { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
export type SyncInfo = { lastSyncAt: number | null; blocked: number; needsSignIn: boolean };
// An account update that has not reached the server: the new header and hashes, and the recovery login token that may sign it, sealed under the vault key.
export type PendingUpdate = { header: string; loginHash: string; readHash: string; ifRev: number; token: string };
type SyncRow = { id: string; sealed: Uint8Array; rev: number };
export interface SyncPort extends SyncStore {
  getSyncLocal(): Promise<{ accountKey: Uint8Array | null; info: SyncInfo; pending: PendingUpdate | null }>;
  setSyncLocal(patch: { info?: SyncInfo; pending?: PendingUpdate | null; headerRev?: number }): Promise<void>;
  // One write: the account, its header and, on a replace, the records, quarantine and meta too.
  setAccount(a: { header: Header; headerRev: number; accountKey: Uint8Array; info: SyncInfo; pending: PendingUpdate | null; replace: { records: SyncRow[]; quarantine: SyncRow[]; lastRev: number } | null }): Promise<void>;
}
export type SyncDeps = { store: SyncPort; transport: Transport };
// A fingerprint check that runs in an extension window (a service worker has no WebAuthn). prf is the 32-byte secret the authenticator derives, when it can.
export interface Fingerprint {
  available(): Promise<boolean>;
  enroll(): Promise<{ credentialId: string; prf?: Uint8Array } | null>;
  verify(credentialId: string): Promise<{ prf?: Uint8Array } | null>;
}
export type FingerprintStatus = { available: boolean; on: boolean; sealed: boolean };
export type Deps = {
  store: RecordStore; session: KV; settings: KV; now(): number; resetAutoLock(): void; syncAlarm?(on: boolean): void; sync?: SyncDeps; kdf?: KdfParams;
  floor?: KdfParams; device?: DeviceVault; fingerprint?: Fingerprint;
};
export type PageRef = { url: string; tabId: number };
export type Ctx = PageRef;
export type LoginInput = { name: string; username: string; password: string; websites: string; note: string };

export type Request =
  | { type: 'status' }
  | { type: 'setup'; password: string }
  | { type: 'confirmRecovery'; group: string }
  | { type: 'unlock'; password: string }
  | { type: 'recover'; recoveryKey: string; password: string }
  | { type: 'lock'; manual?: boolean }
  | { type: 'list' }
  | { type: 'get'; id: string }
  | { type: 'save'; id: string | null; login: LoginInput }
  | { type: 'removeTotp'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'import'; csv: string; commit: boolean }
  | { type: 'export'; password?: string; fingerprint?: true }
  | { type: 'fingerprintStatus' }
  | { type: 'fingerprintOn' }
  | { type: 'fingerprintOff'; password?: string }
  | { type: 'unlockFingerprint' }
  | { type: 'candidates'; page?: PageRef }
  | { type: 'fill'; id: string }
  | { type: 'totpCode'; id: string }
  | { type: 'capture'; username: string; password: string }
  | { type: 'pending'; tabId: number }
  | { type: 'resolvePending'; tabId: number; action: 'save' | 'dismiss' }
  | { type: 'syncStatus' }
  | { type: 'signIn'; password: string; accountKey: string; replace?: boolean }
  | { type: 'signInRecovery'; recoveryKey: string; newPassword: string; accountKey: string; replace?: boolean }
  | { type: 'syncNow' }
  | { type: 'emailRecovery'; action: 'status' }
  // password (not in the brief's sketch): enrol must resend the current loginHash/readHash, derivable only from it.
  | { type: 'emailRecovery'; action: 'enrol'; email: string; password: string }
  | { type: 'emailRecovery'; action: 'confirm'; code: string }
  | { type: 'emailRecovery'; action: 'off' }
  | { type: 'emailRecovery'; action: 'cancelRecovery' }
  | { type: 'lostAccess'; action: 'request' }
  | { type: 'lostAccess'; action: 'check' }
  | { type: 'lostAccess'; action: 'open'; code: string; newPassword: string; replace?: boolean }
  | { type: 'emailSignIn'; action: 'request' }
  | { type: 'emailSignIn'; action: 'check' }
  | { type: 'emailSignIn'; action: 'open'; code: string; password: string; replace?: boolean };

export type Status = { state: 'no-vault' | 'locked' | 'unlocked'; recoveryKey: string | null };
export type Row = { id: string; name: string; username: string; sites: string[]; apps: number; flagged: boolean; totp: boolean };
// Computed at read time from the stored otpauth URI; the URI itself never leaves the service.
export type Detail = { id: string; name: string; username: string; password: string; websites: string; note: string; code: TotpState | null };
export type ImportPreview = { added: number; merged: number; flagged: number };
export type SyncStatus = {
  available: boolean; state: 'off' | 'idle' | 'syncing' | 'needsSignIn' | 'error'; lastSyncAt: number | null; blocked: number; quarantined: number;
  pendingUpdate: boolean; error: string | null; keyLost: boolean;
  // Sync could run, but the keys are sealed under the fingerprint and nobody has unlocked yet.
  paused: boolean;
};
export type Pending = { intent: 'new' | 'update' | null; host: string; username: string; name: string | null; locked: boolean };
export type EmailRecoveryStatus = {
  available: boolean; enrolled: boolean; waitingForCode: boolean; pendingRecovery: { releaseAt: number | null } | null; wasTurnedOff: boolean;
};
export type LostAccessState = { state: 'none' } | { state: 'waiting'; releaseAt: number | null } | { state: 'ready' };

export class UserError extends Error {}

type Captured = { url: string; username: string; password: string; at: number };
type Found = { id: string; login: Login };

const MIN_PASSWORD_CHARS = 12;
const PENDING_TTL_MS = 5 * 60_000;
const MAX_USERNAME_CHARS = 1024;
const MAX_PASSWORD_CHARS = 4096;
const FROM_PAGE = new Set(['candidates', 'fill', 'totpCode', 'capture']);
const NOT_ALLOWED = "That request isn't allowed.";
const LOCKED = 'Strongroom is locked. Unlock it first.';
const UNAVAILABLE = "Sync isn't available in this build.";
const SYNC_OFF = 'Sync is off. Sign in to sync first.';
const PASSWORD_REFUSED = 'The vault server did not accept that password or account key. Check both and try again.';
const RECOVERY_REFUSED = 'The vault server did not accept that recovery key. Check it and try again.';
const BAD_ACCOUNT_KEY = "That account key isn't complete. Check it and try again.";
const KEY_LOST = 'This computer no longer holds your account key. Sign in with your account, using your master password and account key.';
const KEY_DIFFERENT = "That account key doesn't match the one this computer uses. Check it and try again.";
const WEAKER = "The vault server's key settings are weaker than the ones on this computer, so nothing was changed.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD_EMAIL = "That doesn't look like an email address.";
const PENDING_AAD = utf8('strongroom/v1/pending-account-update');
const ESCROW_BLOB = 'escrowBlob';
const ESCROW_CONFIRMED = 'escrowConfirmed';
const LOST_CLAIM = 'lostClaim';
const LOST_BLOB = 'lostBlob';
const CLAIM_BYTES = 20;
const NOT_READY = 'Wait for the 24-hour release, then come back and try again.';
const SIGNIN_CLAIM = 'signinClaim';
const SIGNIN_BLOB = 'signinBlob';
const SIGNIN_DEVICE = 'Strongroom for Chrome';
const SIGNIN_APPROVED = 'This sign-in is already approved. Check again instead of asking again.';
const SIGNIN_NOT_READY = 'Approve the sign-in from the email first, then check again.';
const LOST_STILL_ALIVE = 'A lost-access request is already confirmed, or ready to open. Check again instead of starting a new one.';
const FINGERPRINT = 'fingerprint';
const FP_REFUSED = 'Fingerprint not recognised. Try again, or unlock with your master password.';
const FP_UNAVAILABLE = "This computer can't check a fingerprint here. Use your master password.";
const noop = () => {};

// A word from the common-password list, one repeated character, or a straight run such as abcdefghijkl.
const strong = (password: string) => {
  const codes = [...String(password)].map((c) => c.codePointAt(0)!);
  if (codes.length < MIN_PASSWORD_CHARS) throw new UserError(`Use at least ${MIN_PASSWORD_CHARS} characters for your master password.`);
  const step = codes[1] - codes[0];
  if (COMMON_PASSWORDS.has(String(password).toLowerCase()) || (Math.abs(step) <= 1 && codes.every((c, i) => i === 0 || c - codes[i - 1] === step))) {
    throw new UserError('That password is too common. Pick something only you would think of.');
  }
};

const siteLine = (s: Site) => `${s.https ? 'https' : 'http'}://${s.host}`;

function parseWebsites(text: string): Site[] {
  const sites = new Map<string, Site>();
  for (const line of String(text).split('\n').map((l) => l.trim()).filter(Boolean)) {
    const site = siteFromUrl(line) ?? siteFromUrl(`https://${line}`);
    if (!site) throw new UserError("That website address isn't valid. Start it with https:// and check the spelling.");
    sites.set(siteLine(site), site);
  }
  return [...sites.values()];
}

export function createService(deps: Deps) {
  const { store, session, now } = deps;
  const opts = { kdf: deps.kdf, floor: deps.floor };

  const keyOrNull = async (): Promise<Uint8Array | null> => {
    const stored = await session.get('vaultKey');
    return stored ? fromBase64(stored) : null;
  };
  const requireKey = async (): Promise<Uint8Array> => (await keyOrNull()) ?? Promise.reject(new UserError(LOCKED));
  // Autofill and sync fall back to the vault key the device holds on disk once the session copy is gone, so they keep working without an unlock.
  const fillKey = async (): Promise<Uint8Array | null> => (await keyOrNull()) ?? (await deps.device?.loadKeys())?.vaultKey ?? null;
  const requireFillKey = async (): Promise<Uint8Array> => (await fillKey()) ?? Promise.reject(new UserError(LOCKED));
  // Present while the fingerprint is on: the credential to check, and whether it also seals the vault key (prf) or only gates fills.
  const fpConfig = async (): Promise<{ credentialId: string; prf: boolean } | null> => {
    try {
      const j = JSON.parse((await deps.settings.get(FINGERPRINT)) ?? 'null');
      return j && typeof j.credentialId === 'string' ? { credentialId: j.credentialId, prf: j.prf === true } : null;
    } catch {
      return null;
    }
  };
  const verifyFingerprint = async (cfg: { credentialId: string }) => {
    const v = await deps.fingerprint?.verify(cfg.credentialId);
    if (!v) throw new UserError(FP_REFUSED);
    return v;
  };
  // The key for one fill. With the fingerprint on, every fill asks for it first; with PRF the on-disk copy opens only from that same touch.
  const fillKeyChecked = async (): Promise<Uint8Array> => {
    const cfg = await fpConfig();
    if (!cfg) return requireFillKey();
    const v = await verifyFingerprint(cfg);
    const key = (await keyOrNull()) ?? (await deps.device?.loadKeys(cfg.prf ? v.prf : undefined))?.vaultKey;
    return key ?? Promise.reject(new UserError(LOCKED));
  };
  const fillToken = async (): Promise<Uint8Array | null> => (await tokenOrNull()) ?? (await deps.device?.loadKeys())?.loginToken ?? null;
  // The login token lives only in session storage (memory) while unlocked; lock clears it.
  const opened = async (key: Uint8Array, loginToken?: Uint8Array, prf?: Uint8Array) => {
    await session.set('vaultKey', toBase64(key));
    if (loginToken) {
      await session.set('loginToken', toBase64(loginToken));
      deps.syncAlarm?.(true);
    }
    deps.resetAutoLock();
    try {
      await deps.device?.saveKeys({ vaultKey: key, ...(loginToken && { loginToken }) }, prf);
    } catch {
      // The session key above is already set: the unlock is genuinely usable even if device-level persistence (for lock-free autofill) failed.
    }
  };
  const tokenOrNull = async () => {
    const stored = await session.get('loginToken');
    return stored ? fromBase64(stored) : null;
  };
  const accountKeyOf = async () => (await deps.sync?.store.getSyncLocal())?.accountKey ?? undefined;
  const keyedFor = (h: Header, accountKey?: Uint8Array) => (h.accountKey ? accountKey : undefined);

  // Sync runs one at a time, and sign-in waits its turn, so a sync's write never lands in the middle of a replace.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run);
    chain = next.catch(noop);
    return next;
  };
  let syncing = 0;
  let queued = false;
  const syncSoon = () => {
    if (!deps.sync || queued) return;
    queued = true;
    void exclusive(async () => {
      queued = false;
      await doSync();
    }).catch(noop);
  };

  const logins = async (key: Uint8Array): Promise<{ found: Found[]; unreadable: number }> => {
    const { items, unreadable } = await readEntries(store, key);
    const found = items.flatMap(({ id, entry }) => (entry.type === 'login' ? [{ id, login: entry }] : []));
    return { found, unreadable };
  };

  // Only the current code crosses to a page or the popup; the stored otpauth URI never does.
  const codeStateOf = (login: Login): TotpState | null => {
    if (login.totp === undefined) return null;
    const totp = parseTotp(login.totp);
    return totp && totpState(totp, Math.floor(now() / 1000));
  };

  const row = ({ id, login }: Found): Row => ({
    id, name: login.name, username: login.username, sites: login.sites.map((s) => s.host), apps: login.apps.length,
    flagged: login.note.startsWith(FLAG_PREFIX), totp: login.totp !== undefined,
  });
  const byName = (a: Row, b: Row) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

  const pendingMap = async (): Promise<Record<string, Captured>> => {
    const all: Record<string, Captured> = JSON.parse((await session.get('pending')) ?? '{}');
    return Object.fromEntries(Object.entries(all).filter(([, c]) => now() - c.at <= PENDING_TTL_MS));
  };
  const writePending = (all: Record<string, Captured>) => session.set('pending', JSON.stringify(all));
  const dropPending = async (tabId: number) => {
    const { [String(tabId)]: _gone, ...rest } = await pendingMap();
    await writePending(rest);
  };

  const existingFor = (all: Found[], site: Site, username: string): Found | undefined =>
    all.find((f) => matches(f.login.sites, site) && f.login.username.trim().toLowerCase() === username.trim().toLowerCase());

  async function save(id: string | null, input: LoginInput): Promise<{ id: string }> {
    const key = await requireKey();
    const sites = parseWebsites(input.websites);
    const name = String(input.name).trim() || (sites[0] ? (registrableDomain(sites[0].host) ?? sites[0].host) : '');
    if (name === '') throw new UserError('Give this login a name.');
    const { found } = await logins(key);
    const previous = id === null ? undefined : found.find((f) => f.id === id);
    if (id !== null && !previous) throw new UserError('That login no longer exists.');
    const entry: Login = {
      type: 'login', name, username: String(input.username), password: String(input.password), sites,
      apps: previous?.login.apps ?? [], note: String(input.note),
      // The edit screen does not touch the code yet; rebuilding the login must never drop it.
      ...(previous?.login.totp !== undefined ? { totp: previous.login.totp } : {}),
      updatedAt: now(),
    };
    const savedId = id ?? newId();
    await writeEntries(store, key, [{ id: savedId, entry }]);
    deps.resetAutoLock();
    syncSoon();
    return { id: savedId };
  }

  function unavailable(): SyncDeps {
    if (!deps.sync) throw new UserError(UNAVAILABLE);
    return deps.sync;
  }

  async function syncStatus(): Promise<SyncStatus> {
    if (!deps.sync) return { available: false, state: 'off', lastSyncAt: null, blocked: 0, quarantined: 0, pendingUpdate: false, error: null, keyLost: false, paused: false };
    const { accountKey, info, pending } = await deps.sync.store.getSyncLocal();
    const error = (await session.get('syncError')) ?? null;
    const state = !accountKey ? 'off' : info.needsSignIn ? 'needsSignIn' : syncing > 0 ? 'syncing' : error ? 'error' : 'idle';
    const quarantined = new Set((await deps.sync.store.getQuarantine()).map((q) => q.id)).size;
    const keyLost = !accountKey && (await store.getHeader())?.accountKey === true;
    const paused = accountKey !== null && (await fpConfig())?.prf === true && !(await keyOrNull());
    return { available: true, state, lastSyncAt: info.lastSyncAt, blocked: info.blocked, quarantined, pendingUpdate: pending !== null, error, keyLost, paused };
  }

  async function doSync(password?: string): Promise<SyncReport | null> {
    const { store: port, transport } = deps.sync ?? {};
    if (!port || !transport) return null;
    const { accountKey, info, pending } = await port.getSyncLocal();
    if (!accountKey) return null;
    if (info.needsSignIn) throw new UserError(new SyncAuthError().message);
    let vaultKey = await keyOrNull();
    let token = await tokenOrNull();
    if (!vaultKey || !token) {
      const fromDevice = await deps.device?.loadKeys();
      vaultKey ??= fromDevice?.vaultKey ?? null;
      token ??= fromDevice?.loginToken ?? null;
    }
    if (!vaultKey || !token) throw new UserError(LOCKED);
    syncing++;
    try {
      if (pending) await sendPending(port, transport, pending, vaultKey);
      const report = await syncOnce({ store: port, transport, vaultKey, token });
      if (report.headerChanged && password !== undefined) await adoptServerHeader(port, transport, { vaultKey, token, accountKey, password });
      await port.setSyncLocal({ info: { lastSyncAt: now(), blocked: report.blocked, needsSignIn: false } });
      await session.remove('syncError');
      return report;
    } catch (e) {
      if (e instanceof SyncAuthError) {
        await port.setSyncLocal({ info: { ...info, needsSignIn: true } });
        await session.remove('loginToken');
        throw new UserError(e.message);
      }
      const known = e instanceof SyncHttpError || e instanceof SyncOfflineError || e instanceof SyncRollbackError || e instanceof UserError;
      await session.set('syncError', known ? e.message : 'Sync stopped because of an error. Try again.');
      throw known ? new UserError(e.message) : e;
    } finally {
      syncing--;
    }
  }

  async function sendPending(port: SyncPort, transport: Transport, p: PendingUpdate, vaultKey: Uint8Array) {
    const auth = await open(vaultKey, fromBase64(p.token), PENDING_AAD);
    if (!auth) throw new SyncAuthError();
    try {
      const { headerRev } = await transport.putAccount(auth, { header: p.header, loginHash: p.loginHash, readHash: p.readHash, ifRev: p.ifRev });
      await port.setSyncLocal({ pending: null, headerRev });
    } catch (e) {
      throw e instanceof SyncHttpError && e.status === 409 ? new SyncAuthError() : e;
    }
  }

  async function adoptServerHeader(port: SyncPort, transport: Transport, d: { vaultKey: Uint8Array; token: Uint8Array; accountKey: Uint8Array; password: string }) {
    const before = await port.getSyncMeta();
    const page = await transport.pull(d.token, before.lastRev);
    const remote = headerFromJson(page.header);
    const mine = await store.getHeader();
    if (!remote || !mine || !(page.headerRev >= before.headerRev)) return;
    const adopted = await adoptHeader(mine, remote, d.password, d.accountKey, d.vaultKey);
    if (adopted !== 'refused') await port.applyPull({ header: adopted, headerRev: page.headerRev, records: [], quarantine: [], rebase: [], lastRev: before.lastRev });
  }

  async function signInErrors<T>(run: () => Promise<T>, refused: string): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof SyncAuthError) throw new UserError(refused);
      if (e instanceof SyncHttpError || e instanceof SyncOfflineError || e instanceof SyncRollbackError) throw new UserError(e.message);
      throw e;
    }
  }

  async function localEntries(): Promise<number> {
    const key = await keyOrNull();
    if (!key) return (await store.getRecords()).length;
    const { items, unreadable } = await readEntries(store, key);
    return items.filter(({ entry }) => entry.type !== 'deleted').length + unreadable;
  }

  // Nothing here to lose; the account's own vault (keep local edits and merge); or another vault, which needs a yes first.
  async function plan(s: SignedIn, replace: boolean): Promise<'replace' | 'merge' | { needsConfirm: true; entries: number }> {
    const records = await store.getRecords();
    if (records.length === 0) return 'replace';
    if ((await Promise.all(records.map((r) => openEntry(s.vaultKey, r.id, r.sealed)))).some((e) => e !== null)) {
      const mine = await store.getHeader();
      if (mine && kdfWeaker(s.header.kdf, mine.kdf)) throw new UserError(WEAKER);
      if (s.headerRev < (await unavailable().store.getSyncMeta()).headerRev) throw new UserError(new SyncRollbackError().message);
      return 'merge';
    }
    return replace ? 'replace' : { needsConfirm: true, entries: await localEntries() };
  }

  async function takeAccount(s: SignedIn, how: 'replace' | 'merge', a: { header: Header; accountKey: Uint8Array; loginToken: Uint8Array; pending: PendingUpdate | null }) {
    const info = { lastSyncAt: now(), blocked: s.skipped, needsSignIn: false };
    await unavailable().store.setAccount({
      header: a.header, headerRev: s.headerRev, accountKey: a.accountKey, info, pending: a.pending,
      replace: how === 'replace' ? { records: s.records, quarantine: s.quarantine, lastRev: s.lastRev } : null,
    });
    if (how === 'replace') {
      await session.remove('recovery');
      // A replaced vault has a new key, so a fingerprint-sealed copy of the old one would be wrong: turn the fingerprint off; it can be set up again.
      if (await fpConfig()) {
        await deps.settings.remove(FINGERPRINT);
        await deps.device?.clearKeys();
      }
    }
    await session.remove('syncError');
    await opened(s.vaultKey, a.loginToken);
    if (how === 'merge' || a.pending) await doSync().catch(noop);
  }

  // The new header and hashes wait in storage, with the recovery login token sealed under the vault key, until the server has taken them.
  async function pendingUpdate(header: Header, password: string, accountKey: Uint8Array, recoveryKey: Uint8Array, vaultKey: Uint8Array, ifRev: number) {
    const o = await openWithPassword(header, password, deps.floor, accountKey);
    if (!o || !equalBytes(o.vaultKey, vaultKey)) throw new Error('the new header does not open');
    const token = toBase64(await seal(vaultKey, recoveryLoginToken(recoveryKey), PENDING_AAD));
    return { loginToken: o.loginToken, pending: { header: headerToJson(header), loginHash: tokenHash(o.loginToken), readHash: tokenHash(o.readToken), ifRev, token } };
  }

  async function recoverSynced(recoveryKeyText: string, newPassword: string, accountKey: Uint8Array): Promise<null> {
    const port = unavailable().store;
    const recoveryKey = parseRecoveryKey(recoveryKeyText);
    const header = await store.getHeader();
    const vaultKey = recoveryKey && header && (await unlockWithRecovery(header, recoveryKey));
    if (!vaultKey) throw new UserError("That recovery key doesn't work. Check it and try again.");
    const next = await withNewPassword(header, vaultKey, newPassword, { floor: deps.floor, accountKey });
    const { headerRev } = await port.getSyncMeta();
    const queued = await pendingUpdate(next, newPassword, accountKey, recoveryKey, vaultKey, headerRev);
    await port.setAccount({ header: next, headerRev, accountKey, info: (await port.getSyncLocal()).info, pending: queued.pending, replace: null });
    await opened(vaultKey, queued.loginToken);
    void exclusive(() => doSync()).catch(noop);
    return null;
  }

  async function emailRecoveryStatus(): Promise<EmailRecoveryStatus> {
    const available = deps.sync !== undefined;
    const blob = await deps.settings.get(ESCROW_BLOB);
    const confirmedLocally = (await deps.settings.get(ESCROW_CONFIRMED)) === 'true';
    const waitingForCode = blob !== undefined && !confirmedLocally;
    // Same as doSync: a device that needs to sign in again must not keep hitting the Worker with a token the server
    // already refused, or it self-inflicts the Worker's own auth-failure backoff against its own future requests.
    const needsSignIn = deps.sync ? (await deps.sync.store.getSyncLocal()).info.needsSignIn : false;
    const token = available && !needsSignIn ? await fillToken() : null;
    if (!token || !deps.sync) return { available, enrolled: confirmedLocally, waitingForCode, pendingRecovery: null, wasTurnedOff: false };
    const remote = await deps.sync.transport.lostStatus(token);
    // enrolled reflects the account (the server), not just this device: a device that never did its own enrolling
    // (e.g. one that just finished lostAccessOpen) must still see email recovery as on when the account has it.
    return { available, enrolled: remote.escrow && !waitingForCode, waitingForCode, pendingRecovery: remote.pending, wasTurnedOff: confirmedLocally && !remote.escrow };
  }

  // Rotates the recovery key (Task 11) and mails a fresh code sealed around it and the account key (Task 11's sealEscrow); the put
  // is immediate, not queued like pendingUpdate, so enrol can answer with the new recovery key or a clear "try again" right away.
  async function emailRecoveryEnrol(email: string, password: string): Promise<{ recoveryKey: string }> {
    const { transport, store: port } = unavailable();
    const clean = String(email).trim();
    if (!EMAIL_RE.test(clean) || clean.length > 320) throw new UserError(BAD_EMAIL);
    const vaultKey = await requireKey();
    const token = await tokenOrNull();
    const accountKey = await accountKeyOf();
    if (!token || !accountKey) throw new UserError(SYNC_OFF);
    const header = await store.getHeader();
    if (!header) throw new Error('No vault is set up yet');
    return exclusive(async () => {
      const rotated = await rotateRecoveryKey(header, vaultKey);
      const opened = await openWithPassword(rotated.header, password, deps.floor, accountKey);
      if (!opened || !equalBytes(opened.vaultKey, vaultKey)) throw new UserError("That master password isn't right.");
      const code = generateEmailCode();
      const blob = await sealEscrow(code, { recoveryKey: rotated.recoveryKey, accountKey });
      const signin = { blob: toBase64(await sealSignin(code, accountKey)) };
      const { headerRev } = await port.getSyncMeta();
      try {
        const put = await transport.putAccount(token, {
          header: headerToJson(rotated.header), loginHash: tokenHash(opened.loginToken), readHash: tokenHash(opened.readToken),
          recoveryHash: rotated.recoveryHash, ifRev: headerRev, escrow: { email: clean, blob: toBase64(blob), code: formatEmailCode(code) }, signin,
        });
        await store.commit({ header: rotated.header });
        await port.setSyncLocal({ headerRev: put.headerRev });
      } catch (e) {
        if (!(e instanceof SyncHttpError) || e.status !== 409) throw e;
        await doSync(password).catch(noop);
        throw new UserError('The vault changed on another device. Sync it and try again.');
      }
      await deps.settings.set(ESCROW_BLOB, toBase64(blob));
      await deps.settings.remove(ESCROW_CONFIRMED);
      await session.set('recovery', formatRecoveryKey(rotated.recoveryKey));
      return { recoveryKey: formatRecoveryKey(rotated.recoveryKey) };
    });
  }

  async function emailRecoveryConfirm(code: string): Promise<null> {
    const blobB64 = await deps.settings.get(ESCROW_BLOB);
    if (!blobB64) throw new UserError('Turn on email recovery first.');
    const parsed = parseEmailCode(String(code));
    const opened = parsed && (await openEscrow(parsed, fromBase64(blobB64)));
    if (!opened) throw new UserError("That code isn't right. Check it and try again.");
    await deps.settings.set(ESCROW_CONFIRMED, 'true');
    // storage.local plus the mailed code must not be enough on their own to open the vault: only the flag survives confirm.
    await deps.settings.remove(ESCROW_BLOB);
    return null;
  }

  async function emailRecoveryOff(): Promise<null> {
    const { transport } = unavailable();
    const token = await tokenOrNull();
    if (!token) throw new UserError(SYNC_OFF);
    await transport.deleteEscrow(token);
    await deps.settings.remove(ESCROW_BLOB);
    await deps.settings.remove(ESCROW_CONFIRMED);
    return null;
  }

  async function emailRecoveryCancel(): Promise<null> {
    const { transport } = unavailable();
    const token = await fillToken();
    if (!token) throw new UserError(SYNC_OFF);
    await transport.lostCancel(token);
    return null;
  }

  // Shared by signInRecovery (keys typed in by hand) and lostAccessOpen (keys taken straight out of the opened escrow blob).
  async function recoverWithKeys(recoveryKey: Uint8Array, accountKey: Uint8Array, newPassword: string, replace: boolean): Promise<{ needsConfirm: true; entries: number } | null> {
    const port = unavailable();
    const held = await accountKeyOf();
    if (held && !equalBytes(held, accountKey)) throw new UserError(KEY_DIFFERENT);
    strong(newPassword);
    return await exclusive(async () => {
      const signed = await signInErrors(async () => {
        const s = await signInWithRecovery(port.transport, recoveryKey);
        if (!s.header.accountKey) throw new SyncAuthError();
        return s;
      }, RECOVERY_REFUSED);
      const how = await plan(signed, replace);
      if (typeof how === 'object') return how;
      const header = await withNewPassword(signed.header, signed.vaultKey, newPassword, { floor: deps.floor, accountKey });
      const queued = await pendingUpdate(header, newPassword, accountKey, recoveryKey, signed.vaultKey, signed.headerRev);
      await takeAccount(signed, how, { header, accountKey, loginToken: queued.loginToken, pending: queued.pending });
      return null;
    });
  }

  async function lostAccessRequest(): Promise<null> {
    const { transport } = unavailable();
    const existing = await deps.settings.get(LOST_CLAIM);
    // Ground truth from the server, checked again right here: a stale screen, a double-click or any future UI bug can never overwrite a request the server still calls alive.
    if (existing) {
      const released = await transport.lostRelease(existing);
      if (released.state === 'ready' || released.releaseAt !== null) throw new UserError(LOST_STILL_ALIVE);
    }
    const claim = randomBytes(CLAIM_BYTES);
    // The network call runs before any stored claim/blob is touched, so a failed or offline request leaves an existing one intact.
    await transport.lostRequest(tokenHash(claim));
    await deps.settings.set(LOST_CLAIM, toBase64(claim));
    await deps.settings.remove(LOST_BLOB);
    return null;
  }

  async function lostAccessCheck(): Promise<LostAccessState> {
    const { transport } = unavailable();
    const claim = await deps.settings.get(LOST_CLAIM);
    if (!claim) return { state: 'none' };
    const released = await transport.lostRelease(claim);
    if (released.state === 'waiting') return released;
    await deps.settings.set(LOST_BLOB, released.blob);
    return { state: 'ready' };
  }

  async function lostAccessOpen(code: string, newPassword: string, replace: boolean): Promise<{ needsConfirm: true; entries: number } | null> {
    const blobB64 = await deps.settings.get(LOST_BLOB);
    if (!blobB64) throw new UserError(NOT_READY);
    const parsed = parseEmailCode(String(code));
    const opened = parsed && (await openEscrow(parsed, fromBase64(blobB64)));
    if (!opened) throw new UserError("That code isn't right. Check it and try again.");
    const result = await recoverWithKeys(opened.recoveryKey, opened.accountKey, newPassword, replace);
    if (result === null) {
      await deps.settings.remove(LOST_CLAIM);
      await deps.settings.remove(LOST_BLOB);
    }
    return result;
  }

  // Shared by signIn (account key typed in) and emailSignInOpen (account key from the opened sign-in blob).
  async function signInWithKey(password: string, accountKey: Uint8Array, replace: boolean): Promise<{ needsConfirm: true; entries: number } | null> {
    const port = unavailable();
    return exclusive(async () => {
      const signed = await signInErrors(() => signInWithPassword(port.transport, password, accountKey), PASSWORD_REFUSED);
      const how = await plan(signed, replace);
      if (typeof how === 'object') return how;
      await takeAccount(signed, how, { header: signed.header, accountKey, loginToken: signed.loginToken, pending: null });
      return null;
    });
  }

  // A new device asks by email; the owner approves from the mail, and the Worker then hands over the account key sealed under the enrolment code.
  async function emailSignInRequest(): Promise<null> {
    const { transport } = unavailable();
    // As lostAccessRequest: never drop a claim the server has approved (a stale "Ask again" click).
    const existing = await deps.settings.get(SIGNIN_CLAIM);
    if (existing) {
      const released = await transport.signinRelease(existing);
      if (released.state === 'ready' || released.releaseAt !== null) throw new UserError(SIGNIN_APPROVED);
    }
    const claim = randomBytes(CLAIM_BYTES);
    // Network first, as lostAccessRequest: a failed request leaves an earlier claim intact.
    await transport.signinRequest(tokenHash(claim), SIGNIN_DEVICE);
    await deps.settings.set(SIGNIN_CLAIM, toBase64(claim));
    await deps.settings.remove(SIGNIN_BLOB);
    return null;
  }

  async function emailSignInCheck(): Promise<LostAccessState> {
    const { transport } = unavailable();
    const claim = await deps.settings.get(SIGNIN_CLAIM);
    if (!claim) return { state: 'none' };
    // Already released here: the server forgets it an hour later, but this device can still use it.
    if (await deps.settings.get(SIGNIN_BLOB)) return { state: 'ready' };
    const released = await transport.signinRelease(claim);
    if (released.state === 'waiting') return released;
    await deps.settings.set(SIGNIN_BLOB, released.blob);
    return { state: 'ready' };
  }

  async function emailSignInOpen(code: string, password: string, replace: boolean): Promise<{ needsConfirm: true; entries: number } | null> {
    const blobB64 = await deps.settings.get(SIGNIN_BLOB);
    if (!blobB64) throw new UserError(SIGNIN_NOT_READY);
    const parsed = parseEmailCode(String(code));
    const accountKey = parsed && (await openSignin(parsed, fromBase64(blobB64)));
    if (!accountKey) throw new UserError("That code isn't right. Check it and try again.");
    const held = await accountKeyOf();
    if (held && !equalBytes(held, accountKey)) throw new UserError(KEY_DIFFERENT);
    const result = await signInWithKey(String(password), accountKey, replace);
    if (result === null) {
      await deps.settings.remove(SIGNIN_CLAIM);
      await deps.settings.remove(SIGNIN_BLOB);
    }
    return result;
  }

  async function handle(req: Request, ctx?: Ctx): Promise<unknown> {
    const type = (req as { type?: unknown })?.type;
    const fromPage = ctx !== undefined;
    if (typeof type !== 'string' || (fromPage && !FROM_PAGE.has(type))) throw new UserError(NOT_ALLOWED);
    const where = fromPage ? ctx : (req as { page?: PageRef }).page;
    if (FROM_PAGE.has(type) && (!where || ((type === 'capture' || type === 'fill' || type === 'totpCode') && !ctx))) throw new UserError(NOT_ALLOWED);

    try {
      switch (req.type) {
        case 'status': {
          const header = await store.getHeader();
          const key = header ? await keyOrNull() : null;
          return { state: !header ? 'no-vault' : key ? 'unlocked' : 'locked', recoveryKey: key ? ((await session.get('recovery')) ?? null) : null } satisfies Status;
        }
        case 'setup': {
          strong(req.password);
          const { vaultKey, recoveryKey } = await setupVault(store, req.password, opts);
          await session.set('recovery', formatRecoveryKey(recoveryKey));
          await opened(vaultKey);
          return null;
        }
        case 'confirmRecovery': {
          await requireKey();
          const shown = await session.get('recovery');
          if (!shown || String(req.group).trim().toUpperCase() !== recoveryKeyGroup(shown, 0)) throw new UserError("That group doesn't match your recovery key. Check the first four characters.");
          await session.remove('recovery');
          return null;
        }
        case 'unlock': {
          const header = await store.getHeader();
          if (!header) throw new Error('No vault is set up yet');
          const accountKey = keyedFor(header, await accountKeyOf());
          const keys = await openWithPassword(header, req.password, deps.floor, accountKey);
          if (keys === null) throw new UserError("That master password isn't right.");
          await opened(keys.vaultKey, accountKey ? keys.loginToken : undefined);
          if (accountKey) void exclusive(() => doSync(req.password)).catch(noop);
          return null;
        }
        case 'fingerprintStatus': {
          const cfg = await fpConfig();
          return { available: (await deps.fingerprint?.available().catch(() => false)) === true, on: cfg !== null, sealed: cfg?.prf === true } satisfies FingerprintStatus;
        }
        case 'fingerprintOn': {
          const fp = deps.fingerprint;
          if (!fp || !(await fp.available().catch(() => false))) throw new UserError(FP_UNAVAILABLE);
          if (await fpConfig()) throw new UserError('The fingerprint is already on.');
          const key = await requireKey();
          const enrolled = await fp.enroll();
          if (!enrolled) throw new UserError('The fingerprint was not set up. Try again.');
          let sealed = false;
          if (enrolled.prf && deps.device) {
            try {
              const token = await tokenOrNull();
              await deps.device.saveKeys({ vaultKey: key, ...(token && { loginToken: token }) });
              await deps.device.protect(enrolled.prf);
              sealed = (await deps.device.mode()) === 'fingerprint';
            } catch {
              // Sealing failed (a short secret, no IndexedDB): the device-sealed copy is still there, so this is the gate-only mode.
            }
          }
          await deps.settings.set(FINGERPRINT, JSON.stringify({ credentialId: enrolled.credentialId, prf: sealed }));
          deps.resetAutoLock();
          return { available: true, on: true, sealed } satisfies FingerprintStatus;
        }
        case 'fingerprintOff': {
          const cfg = await fpConfig();
          if (!cfg) return null;
          if (req.password !== undefined) {
            // The master-password way out, for a credential that is gone: it re-seals the keys under the device key.
            const header = await store.getHeader();
            const accountKey = header && keyedFor(header, await accountKeyOf());
            const keys = header && (await openWithPassword(header, String(req.password), deps.floor, accountKey || undefined));
            if (!keys) throw new UserError("That master password isn't right.");
            await deps.device?.clearKeys();
            await deps.device?.saveKeys({ vaultKey: keys.vaultKey, ...(accountKey && { loginToken: keys.loginToken }) });
          } else {
            const v = await verifyFingerprint(cfg);
            if ((await deps.device?.mode()) === 'fingerprint') {
              if (!v.prf) throw new UserError(FP_REFUSED);
              await deps.device?.unprotect(v.prf);
              if ((await deps.device?.mode()) === 'fingerprint') throw new UserError(FP_REFUSED);
            }
          }
          await deps.settings.remove(FINGERPRINT);
          return null;
        }
        case 'unlockFingerprint': {
          const cfg = await fpConfig();
          if (!cfg) throw new UserError(FP_UNAVAILABLE);
          const v = await verifyFingerprint(cfg);
          const keys = await deps.device?.loadKeys(cfg.prf ? v.prf : undefined);
          if (!keys) throw new UserError('The fingerprint is right, but this computer no longer holds your key. Unlock with your master password this time.');
          await opened(keys.vaultKey, keys.loginToken, cfg.prf ? v.prf : undefined);
          void exclusive(() => doSync()).catch(noop);
          return null;
        }
        case 'recover': {
          strong(req.password);
          const accountKey = await accountKeyOf();
          if (accountKey) return await exclusive(() => recoverSynced(req.recoveryKey, req.password, accountKey));
          const key = await recover(store, req.recoveryKey, req.password, { floor: deps.floor });
          if (key === null) throw new UserError("That recovery key doesn't work. Check it and try again.");
          await opened(key);
          return null;
        }
        case 'lock':
          await session.remove('vaultKey');
          await session.remove('pending');
          await session.remove('loginToken');
          // A non-manual lock (auto-lock) leaves the device-held keys in place, so background sync keeps answering from them; only stop the alarm when it won't.
          if (req.manual || !deps.device) deps.syncAlarm?.(false);
          // A fingerprint-sealed copy cannot be opened without a touch, so a manual lock leaves it; the device-sealed copy is the one it clears.
          if (req.manual && (await deps.device?.mode()) !== 'fingerprint') await deps.device?.clearKeys();
          return null;
        case 'syncStatus':
          return await syncStatus();
        case 'syncNow':
          unavailable();
          return await exclusive(async () => (await doSync()) ?? Promise.reject(new UserError(SYNC_OFF)));
        case 'emailRecovery':
          switch (req.action) {
            case 'status': return await emailRecoveryStatus();
            case 'enrol': return await emailRecoveryEnrol(req.email, req.password);
            case 'confirm': return await emailRecoveryConfirm(req.code);
            case 'off': return await emailRecoveryOff();
            case 'cancelRecovery': return await emailRecoveryCancel();
            default: throw new UserError(NOT_ALLOWED);
          }
        case 'lostAccess': {
          unavailable();
          if (await keyOrNull()) throw new UserError('Strongroom is already unlocked. Lock it first.');
          switch (req.action) {
            case 'request': return await lostAccessRequest();
            case 'check': return await lostAccessCheck();
            case 'open': return await lostAccessOpen(req.code, req.newPassword, req.replace === true);
            default: throw new UserError(NOT_ALLOWED);
          }
        }
        case 'signIn': {
          unavailable();
          const accountKey = parseAccountKey(String(req.accountKey));
          if (!accountKey) throw new UserError(BAD_ACCOUNT_KEY);
          return await signInWithKey(String(req.password), accountKey, req.replace === true);
        }
        case 'emailSignIn': {
          switch (req.action) {
            case 'request': return await emailSignInRequest();
            case 'check': return await emailSignInCheck();
            case 'open': return await emailSignInOpen(req.code, req.password, req.replace === true);
            default: throw new UserError(NOT_ALLOWED);
          }
        }
        case 'signInRecovery': {
          unavailable();
          const recoveryKey = parseRecoveryKey(String(req.recoveryKey));
          const accountKey = parseAccountKey(String(req.accountKey));
          if (!recoveryKey) throw new UserError(RECOVERY_REFUSED);
          if (!accountKey) throw new UserError(BAD_ACCOUNT_KEY);
          return await recoverWithKeys(recoveryKey, accountKey, req.newPassword, req.replace === true);
        }
        case 'list': {
          const { found, unreadable } = await logins(await requireKey());
          deps.resetAutoLock();
          return { rows: found.map(row).sort(byName), unreadable };
        }
        case 'get': {
          const target = (await logins(await requireKey())).found.find((f) => f.id === req.id);
          if (!target) throw new UserError('That login no longer exists.');
          deps.resetAutoLock();
          const l = target.login;
          return {
            id: target.id, name: l.name, username: l.username, password: l.password, websites: l.sites.map(siteLine).join('\n'), note: l.note,
            code: codeStateOf(l),
          } satisfies Detail;
        }
        case 'save':
          return await save(req.id, req.login);
        case 'removeTotp': {
          const key = await requireKey();
          const target = (await logins(key)).found.find((f) => f.id === req.id);
          if (!target) throw new UserError('That login no longer exists.');
          if (target.login.totp !== undefined) {
            const { totp: _removed, ...login } = target.login;
            await writeEntries(store, key, [{ id: req.id, entry: { ...login, updatedAt: now() } }]);
            deps.resetAutoLock();
            syncSoon();
          }
          return null;
        }
        case 'remove': {
          const key = await requireKey();
          if (!(await logins(key)).found.some((f) => f.id === req.id)) throw new UserError('That login no longer exists.');
          await writeEntries(store, key, [{ id: req.id, entry: { type: 'deleted', updatedAt: now() } }]);
          deps.resetAutoLock();
          syncSoon();
          return null;
        }
        case 'import': {
          const key = await requireKey();
          const result = parseGoogleExport(String(req.csv), now());
          if (req.commit) await writeEntries(store, key, result.logins.map((entry: Entry) => ({ id: newId(), entry })));
          deps.resetAutoLock();
          if (req.commit) syncSoon();
          return { added: result.logins.length, merged: result.merged, flagged: result.flagged } satisfies ImportPreview;
        }
        case 'export': {
          const key = await requireKey();
          // Re-checking the password (or the fingerprint) stops someone at an unlocked, unattended browser from taking every password in plain text.
          if (req.fingerprint === true) {
            const cfg = await fpConfig();
            if (!cfg) throw new UserError(FP_UNAVAILABLE);
            await verifyFingerprint(cfg);
          } else {
            const header = await store.getHeader();
            const keys = header && (await openWithPassword(header, String(req.password), deps.floor, keyedFor(header, await accountKeyOf())));
            if (!keys || !equalBytes(keys.vaultKey, key)) throw new UserError("That master password isn't right.");
          }
          deps.resetAutoLock();
          return exportForChrome((await logins(key)).found.map((f) => f.login));
        }
        case 'candidates': {
          const site = where && siteFromUrl(where.url);
          const key = await fillKey();
          if (!key) return { locked: true, rows: [] };
          const { found } = await logins(key);
          return { locked: false, rows: site ? found.filter((f) => matches(f.login.sites, site)).map(row).sort(byName) : [] };
        }
        case 'fill': {
          const site = where && siteFromUrl(where.url);
          if (!site) throw new UserError(NOT_ALLOWED);
          const target = (await logins(await fillKeyChecked())).found.find((f) => f.id === req.id);
          if (!target || !matches(target.login.sites, site)) throw new UserError("That login isn't saved for this website.");
          deps.resetAutoLock();
          return { username: target.login.username, password: target.login.password, code: codeStateOf(target.login) };
        }
        case 'totpCode': {
          // Same gate as fill: the request must come from the page itself and the login must match that page.
          // The phone refuses codes while locked; the extension follows its own lock-free fill policy, so the
          // device-held key answers here exactly as it does for a password.
          const site = where && siteFromUrl(where.url);
          if (!site) throw new UserError(NOT_ALLOWED);
          const target = (await logins(await requireFillKey())).found.find((f) => f.id === req.id);
          if (!target || !matches(target.login.sites, site)) throw new UserError("That login isn't saved for this website.");
          deps.resetAutoLock();
          return codeStateOf(target.login);
        }
        case 'capture': {
          const site = siteFromUrl(ctx!.url);
          const username = String(req.username);
          const password = String(req.password);
          if (!site || !password || username.length > MAX_USERNAME_CHARS || password.length > MAX_PASSWORD_CHARS) return null;
          const all = await pendingMap();
          all[String(ctx!.tabId)] = { url: ctx!.url, username, password, at: now() };
          await writePending(all);
          return null;
        }
        case 'pending': {
          const captured = (await pendingMap())[String(req.tabId)];
          const site = captured && siteFromUrl(captured.url);
          if (!captured || !site) return null;
          const key = await keyOrNull();
          if (!key) return { intent: null, host: site.host, username: captured.username, name: null, locked: true } satisfies Pending;
          const existing = existingFor((await logins(key)).found, site, captured.username);
          if (existing?.login.password === captured.password) {
            await dropPending(req.tabId);
            return null;
          }
          return { intent: existing ? 'update' : 'new', host: site.host, username: captured.username, name: existing?.login.name ?? null, locked: false } satisfies Pending;
        }
        case 'resolvePending': {
          if (req.action === 'dismiss') {
            await dropPending(req.tabId);
            return null;
          }
          const key = await requireKey();
          const captured = (await pendingMap())[String(req.tabId)];
          const site = captured && siteFromUrl(captured.url);
          if (!captured || !site) throw new UserError('That sign-in is no longer waiting to be saved.');
          const existing = existingFor((await logins(key)).found, site, captured.username);
          if (existing) {
            await writeEntries(store, key, [{ id: existing.id, entry: { ...existing.login, password: captured.password, updatedAt: now() } }]);
          } else {
            const entry: Login = { type: 'login', name: registrableDomain(site.host) ?? site.host, username: captured.username, password: captured.password, sites: [site], apps: [], note: '', updatedAt: now() };
            await writeEntries(store, key, [{ id: newId(), entry }]);
          }
          await dropPending(req.tabId);
          deps.resetAutoLock();
          syncSoon();
          return null;
        }
        default:
          throw new UserError(NOT_ALLOWED);
      }
    } catch (e) {
      if (e instanceof ImportError) throw new UserError(e.message);
      if (e instanceof KdfOutOfRange) throw new UserError("This vault's key settings are outside what Strongroom accepts, so it was not opened.");
      if (e instanceof AccountKeyRequired) throw new UserError(KEY_LOST);
      throw e;
    }
  }

  return { handle, settled: () => chain.then(noop) };
}
