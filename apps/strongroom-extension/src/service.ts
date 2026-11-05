import {
  FLAG_PREFIX, ImportError, KdfOutOfRange, fromBase64, formatRecoveryKey, matches, newId, parseGoogleExport, readEntries,
  recoveryKeyGroup, recover, registrableDomain, setupVault, siteFromUrl, toBase64, unlock, writeEntries,
} from 'strongroom-core';
import type { Entry, KdfParams, Login, RecordStore, Site } from 'strongroom-core';

export type KV = { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
export type Deps = { store: RecordStore; session: KV; now(): number; resetAutoLock(): void; kdf?: KdfParams; floor?: KdfParams };
export type PageRef = { url: string; tabId: number };
export type Ctx = PageRef;
export type LoginInput = { name: string; username: string; password: string; websites: string; note: string };

export type Request =
  | { type: 'status' }
  | { type: 'setup'; password: string }
  | { type: 'confirmRecovery'; group: string }
  | { type: 'unlock'; password: string }
  | { type: 'recover'; recoveryKey: string; password: string }
  | { type: 'lock' }
  | { type: 'list' }
  | { type: 'get'; id: string }
  | { type: 'save'; id: string | null; login: LoginInput }
  | { type: 'remove'; id: string }
  | { type: 'import'; csv: string; commit: boolean }
  | { type: 'candidates'; page?: PageRef }
  | { type: 'fill'; id: string }
  | { type: 'capture'; username: string; password: string }
  | { type: 'pending'; tabId: number }
  | { type: 'resolvePending'; tabId: number; action: 'save' | 'dismiss' };

export type Status = { state: 'no-vault' | 'locked' | 'unlocked'; recoveryKey: string | null };
export type Row = { id: string; name: string; username: string; sites: string[]; apps: number; flagged: boolean };
export type Detail = { id: string; name: string; username: string; password: string; websites: string; note: string };
export type ImportPreview = { added: number; merged: number; flagged: number };
export type Pending = { intent: 'new' | 'update' | null; host: string; username: string; name: string | null; locked: boolean };

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

// One repeated character, or a straight run such as abcdefghijkl; the common-password list from DESIGN §6 is not built yet.
const strong = (password: string) => {
  const codes = [...String(password)].map((c) => c.codePointAt(0)!);
  if (codes.length < MIN_PASSWORD_CHARS) throw new UserError(`Use at least ${MIN_PASSWORD_CHARS} characters for your master password.`);
  const step = codes[1] - codes[0];
  if (Math.abs(step) <= 1 && codes.every((c, i) => i === 0 || c - codes[i - 1] === step)) {
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
  const opened = async (key: Uint8Array) => {
    await session.set('vaultKey', toBase64(key));
    deps.resetAutoLock();
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
    return { id: savedId };
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
          const key = await unlock(store, req.password, deps.floor);
          if (key === null) throw new UserError("That master password isn't right.");
          await opened(key);
          return null;
        }
        case 'recover': {
          strong(req.password);
          const key = await recover(store, req.recoveryKey, req.password, { floor: deps.floor });
          if (key === null) throw new UserError("That recovery key doesn't work. Check it and try again.");
          await opened(key);
          return null;
        }
        case 'lock':
          await session.remove('vaultKey');
          await session.remove('pending');
          return null;
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
          return null;
        }
        case 'import': {
          const key = await requireKey();
          const result = parseGoogleExport(String(req.csv), now());
          if (req.commit) await writeEntries(store, key, result.logins.map((entry: Entry) => ({ id: newId(), entry })));
          deps.resetAutoLock();
          return { added: result.logins.length, merged: result.merged, flagged: result.flagged } satisfies ImportPreview;
        }
        case 'candidates': {
          const site = where && siteFromUrl(where.url);
          const key = await keyOrNull();
          if (!key) return { locked: true, rows: [] };
          const { found } = await logins(key);
          return { locked: false, rows: site ? found.filter((f) => matches(f.login.sites, site)).map(row).sort(byName) : [] };
        }
        case 'fill': {
          const site = where && siteFromUrl(where.url);
          if (!site) throw new UserError(NOT_ALLOWED);
          const target = (await logins(await requireKey())).found.find((f) => f.id === req.id);
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
          return null;
        }
        default:
          throw new UserError(NOT_ALLOWED);
      }
    } catch (e) {
      if (e instanceof ImportError) throw new UserError(e.message);
      if (e instanceof KdfOutOfRange) throw new UserError("This vault's key settings are outside what Strongroom accepts, so it was not opened.");
      throw e;
    }
  }

  return { handle };
}
