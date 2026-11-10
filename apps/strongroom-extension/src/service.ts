import {
  AccountKeyRequired, FLAG_PREFIX, ImportError, KdfOutOfRange, SyncAuthError, SyncHttpError, SyncOfflineError, SyncRollbackError, adoptHeader,
  equalBytes, exportForChrome, formatEmailCode, fromBase64, formatRecoveryKey, generateEmailCode, headerFromJson, headerToJson, kdfWeaker, matches,
  newId, open, openEntry, openEscrow, openWithPassword, parseAccountKey, parseEmailCode, parseGoogleExport, parseRecoveryKey, readEntries,
  recoveryKeyGroup, recoveryLoginToken, recover, registrableDomain, rotateRecoveryKey, seal, sealEscrow, setupVault, signInWithPassword,
  signInWithRecovery, siteFromUrl, syncOnce, toBase64, tokenHash, unlockWithRecovery, utf8, withNewPassword, writeEntries,
} from 'strongroom-core';
import type { Entry, Header, KdfParams, Login, RecordStore, Site, SignedIn, SyncReport, SyncStore, Transport } from 'strongroom-core';
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
export type Deps = {
  store: RecordStore; session: KV; settings: KV; now(): number; resetAutoLock(): void; syncAlarm?(on: boolean): void; sync?: SyncDeps; kdf?: KdfParams;
  floor?: KdfParams; device?: DeviceVault;
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
  | { type: 'remove'; id: string }
  | { type: 'import'; csv: string; commit: boolean }
  | { type: 'export'; password: string }
  | { type: 'candidates'; page?: PageRef }
  | { type: 'fill'; id: string }
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
  | { type: 'emailRecovery'; action: 'cancelRecovery' };

export type Status = { state: 'no-vault' | 'locked' | 'unlocked'; recoveryKey: string | null };
export type Row = { id: string; name: string; username: string; sites: string[]; apps: number; flagged: boolean };
export type Detail = { id: string; name: string; username: string; password: string; websites: string; note: string };
export type ImportPreview = { added: number; merged: number; flagged: number };
export type SyncStatus = {
  available: boolean; state: 'off' | 'idle' | 'syncing' | 'needsSignIn' | 'error'; lastSyncAt: number | null; blocked: number; quarantined: number;
  pendingUpdate: boolean; error: string | null; keyLost: boolean;
};
export type Pending = { intent: 'new' | 'update' | null; host: string; username: string; name: string | null; locked: boolean };
export type EmailRecoveryStatus = {
  available: boolean; enrolled: boolean; waitingForCode: boolean; pendingRecovery: { releaseAt: number | null } | null; wasTurnedOff: boolean;
};

export class UserError extends Error {}

type Captured = { url: string; username: string; password: string; at: number };
type Found = { id: string; login: Login };

const MIN_PASSWORD_CHARS = 12;
const PENDING_TTL_MS = 5 * 60_000;
const MAX_USERNAME_CHARS = 1024;
const MAX_PASSWORD_CHARS = 4096;
const FROM_PAGE = new Set(['candidates', 'fill', 'capture']);
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
  // The login token lives only in session storage (memory) while unlocked; lock clears it.
  const opened = async (key: Uint8Array, loginToken?: Uint8Array) => {
    await session.set('vaultKey', toBase64(key));
    if (loginToken) {
      await session.set('loginToken', toBase64(loginToken));
      deps.syncAlarm?.(true);
    }
    await deps.device?.saveKeys({ vaultKey: key, ...(loginToken && { loginToken }) });
    deps.resetAutoLock();
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

  const row = ({ id, login }: Found): Row => ({
    id, name: login.name, username: login.username, sites: login.sites.map((s) => s.host), apps: login.apps.length,
    flagged: login.note.startsWith(FLAG_PREFIX),
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
      apps: previous?.login.apps ?? [], note: String(input.note), updatedAt: now(),
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
    if (!deps.sync) return { available: false, state: 'off', lastSyncAt: null, blocked: 0, quarantined: 0, pendingUpdate: false, error: null, keyLost: false };
    const { accountKey, info, pending } = await deps.sync.store.getSyncLocal();
    const error = (await session.get('syncError')) ?? null;
    const state = !accountKey ? 'off' : info.needsSignIn ? 'needsSignIn' : syncing > 0 ? 'syncing' : error ? 'error' : 'idle';
    const quarantined = new Set((await deps.sync.store.getQuarantine()).map((q) => q.id)).size;
    const keyLost = !accountKey && (await store.getHeader())?.accountKey === true;
    return { available: true, state, lastSyncAt: info.lastSyncAt, blocked: info.blocked, quarantined, pendingUpdate: pending !== null, error, keyLost };
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
    if (how === 'replace') await session.remove('recovery');
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
    const token = available ? await tokenOrNull() : null;
    if (!token || !deps.sync) return { available, enrolled: confirmedLocally, waitingForCode, pendingRecovery: null, wasTurnedOff: false };
    const remote = await deps.sync.transport.lostStatus(token);
    return { available, enrolled: confirmedLocally && remote.escrow, waitingForCode, pendingRecovery: remote.pending, wasTurnedOff: confirmedLocally && !remote.escrow };
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
      const { headerRev } = await port.getSyncMeta();
      try {
        const put = await transport.putAccount(token, {
          header: headerToJson(rotated.header), loginHash: tokenHash(opened.loginToken), readHash: tokenHash(opened.readToken),
          recoveryHash: rotated.recoveryHash, ifRev: headerRev, escrow: { email: clean, blob: toBase64(blob), code: formatEmailCode(code) },
        });
        await store.commit({ header: rotated.header });
        await port.setSyncLocal({ headerRev: put.headerRev });
      } catch (e) {
        if (!(e instanceof SyncHttpError) || e.status !== 409) throw e;
        await doSync().catch(noop);
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
    const token = await tokenOrNull();
    if (!token) throw new UserError(SYNC_OFF);
    await transport.lostCancel(token);
    return null;
  }

  async function handle(req: Request, ctx?: Ctx): Promise<unknown> {
    const type = (req as { type?: unknown })?.type;
    const fromPage = ctx !== undefined;
    if (typeof type !== 'string' || (fromPage && !FROM_PAGE.has(type))) throw new UserError(NOT_ALLOWED);
    const where = fromPage ? ctx : (req as { page?: PageRef }).page;
    if (FROM_PAGE.has(type) && (!where || ((type === 'capture' || type === 'fill') && !ctx))) throw new UserError(NOT_ALLOWED);

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
          if (req.manual) await deps.device?.clearKeys();
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
        case 'signIn': {
          const port = unavailable();
          const accountKey = parseAccountKey(String(req.accountKey));
          if (!accountKey) throw new UserError(BAD_ACCOUNT_KEY);
          return await exclusive(async () => {
            const signed = await signInErrors(() => signInWithPassword(port.transport, String(req.password), accountKey), PASSWORD_REFUSED);
            const how = await plan(signed, req.replace === true);
            if (typeof how === 'object') return how;
            await takeAccount(signed, how, { header: signed.header, accountKey, loginToken: signed.loginToken, pending: null });
            return null;
          });
        }
        case 'signInRecovery': {
          const port = unavailable();
          const recoveryKey = parseRecoveryKey(String(req.recoveryKey));
          const accountKey = parseAccountKey(String(req.accountKey));
          if (!recoveryKey) throw new UserError(RECOVERY_REFUSED);
          if (!accountKey) throw new UserError(BAD_ACCOUNT_KEY);
          const held = await accountKeyOf();
          if (held && !equalBytes(held, accountKey)) throw new UserError(KEY_DIFFERENT);
          strong(req.newPassword);
          return await exclusive(async () => {
            const signed = await signInErrors(async () => {
              const s = await signInWithRecovery(port.transport, recoveryKey);
              if (!s.header.accountKey) throw new SyncAuthError();
              return s;
            }, RECOVERY_REFUSED);
            const how = await plan(signed, req.replace === true);
            if (typeof how === 'object') return how;
            const header = await withNewPassword(signed.header, signed.vaultKey, req.newPassword, { floor: deps.floor, accountKey });
            const queued = await pendingUpdate(header, req.newPassword, accountKey, recoveryKey, signed.vaultKey, signed.headerRev);
            await takeAccount(signed, how, { header, accountKey, loginToken: queued.loginToken, pending: queued.pending });
            return null;
          });
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
          return { id: target.id, name: l.name, username: l.username, password: l.password, websites: l.sites.map(siteLine).join('\n'), note: l.note } satisfies Detail;
        }
        case 'save':
          return await save(req.id, req.login);
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
          // Re-checking the password stops someone at an unlocked, unattended browser from taking every password in plain text.
          const header = await store.getHeader();
          const keys = header && (await openWithPassword(header, String(req.password), deps.floor, keyedFor(header, await accountKeyOf())));
          if (!keys || !equalBytes(keys.vaultKey, key)) throw new UserError("That master password isn't right.");
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
          const target = (await logins(await requireFillKey())).found.find((f) => f.id === req.id);
          if (!target || !matches(target.login.sites, site)) throw new UserError("That login isn't saved for this website.");
          deps.resetAutoLock();
          return { username: target.login.username, password: target.login.password };
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
