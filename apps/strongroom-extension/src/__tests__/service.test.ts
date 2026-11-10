import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createVault, formatAccountKey, headerToJson, KDF_FLOOR, loadPublicSuffixList, parseRecoveryKey, randomBytes, recoveryLoginToken, rotateRecoveryKey,
  signInWithPassword, signInWithRecovery, SyncAuthError, toBase64, tokenHash, unlockWithRecovery,
} from 'strongroom-core';
import type { Header, RecordStore, StoredRecord, SyncReport } from 'strongroom-core';
import { COMMON_PASSWORDS } from '../common-passwords.ts';
import { createService } from '../service.ts';
import type { Ctx, Detail, EmailRecoveryStatus, ImportPreview, KV, Pending, Row, Status, SyncStatus } from '../service.ts';
import { createLocalStore, localKv } from '../storage.ts';
import { createDeviceVault } from '../device-vault.ts';
import type { DeviceVault, KeyStore } from '../device-vault.ts';
import { fakeChrome, loginEntry, newWorld, PHONE_PASSWORD, useChrome } from './sync-world.ts';
import type { World } from './sync-world.ts';

const android = '../../../strongroom/modules/strongroom-vault/android/src';
loadPublicSuffixList(readFileSync(new URL(`${android}/main/resources/public_suffix_list.dat`, import.meta.url), 'utf8'));
const redacted = readFileSync(new URL(`${android}/test/resources/google-export-redacted.csv`, import.meta.url), 'utf8');

class MemoryStore implements RecordStore {
  header: Header | null = null;
  records = new Map<string, Uint8Array>();
  async getHeader() { return this.header; }
  async getRecords(): Promise<StoredRecord[]> { return [...this.records].map(([id, sealed]) => ({ id, sealed })); }
  async commit(change: { header?: Header; records?: StoredRecord[] }) {
    if (change.header) this.header = change.header;
    for (const r of change.records ?? []) this.records.set(r.id, r.sealed);
  }
}

const memoryKv = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
};

const PASSWORD = 'a long master password';
const LOW = { kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1 }, floor: { memoryKiB: 8, iterations: 1, parallelism: 1 } };

// A real DeviceVault over in-memory storage, the same shape as `extension()`'s further down: no own crypto, just fake KV and KeyStore.
function deviceVault(): DeviceVault {
  let key: CryptoKey | undefined;
  const keys: KeyStore = { get: async () => (key ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])), put: async (k) => void (key = k) };
  return createDeviceVault(memoryKv(), keys);
}

function setup(device?: DeviceVault) {
  const store = new MemoryStore();
  const session = memoryKv();
  const clock = { t: 1_000_000 };
  const timer = { resets: 0 };
  const service = createService({ store, session, settings: memoryKv(), now: () => clock.t, resetAutoLock: () => timer.resets++, device, ...LOW });
  const call = <T>(req: object, ctx?: Ctx) => service.handle(req as never, ctx) as Promise<T>;
  return { store, session, clock, timer, service, call };
}

async function unlocked(device?: DeviceVault) {
  const s = setup(device);
  await s.call({ type: 'setup', password: PASSWORD });
  return s;
}

const page = (url: string, tabId = 1): Ctx => ({ url, tabId });
const login = (over: object = {}) => ({ name: 'Bank', username: 'me', password: 'pw-1', websites: 'https://login.bank.com/signin', note: '', ...over });
const add = <T = { id: string }>(s: { call<R>(req: object, ctx?: Ctx): Promise<R> }, over: object = {}) => s.call<T>({ type: 'save', id: null, login: login(over) });

test('a new profile has no vault; setup creates one, unlocks it and holds the recovery key until it is confirmed', async () => {
  const { call } = setup();
  assert.equal((await call<Status>({ type: 'status' })).state, 'no-vault');
  await call({ type: 'setup', password: PASSWORD });
  const status = await call<Status>({ type: 'status' });
  assert.equal(status.state, 'unlocked');
  assert.match(status.recoveryKey ?? '', /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
});

test('setup refuses a master password shorter than 12 characters', async () => {
  const { call } = setup();
  await assert.rejects(call({ type: 'setup', password: 'too short' }), /12 characters/);
  assert.equal((await call<Status>({ type: 'status' })).state, 'no-vault');
});

test('the recovery key is held until the owner types back its first group', async () => {
  const { call } = await unlocked();
  const key = (await call<Status>({ type: 'status' })).recoveryKey!;
  await assert.rejects(call({ type: 'confirmRecovery', group: 'ZZZZ' }), /doesn't match/);
  assert.equal((await call<Status>({ type: 'status' })).recoveryKey, key);
  await call({ type: 'confirmRecovery', group: key.slice(0, 4).toLowerCase() });
  assert.equal((await call<Status>({ type: 'status' })).recoveryKey, null);
});

test('lock then unlock; a wrong master password says so and stays locked', async () => {
  const { call } = await unlocked();
  await call({ type: 'lock' });
  assert.equal((await call<Status>({ type: 'status' })).state, 'locked');
  await assert.rejects(call({ type: 'unlock', password: 'the wrong password' }), /isn't right/);
  assert.equal((await call<Status>({ type: 'status' })).state, 'locked');
  await call({ type: 'unlock', password: PASSWORD });
  assert.equal((await call<Status>({ type: 'status' })).state, 'unlocked');
});

test('the recovery key sets a new master password and unlocks', async () => {
  const s = await unlocked();
  const key = (await s.call<Status>({ type: 'status' })).recoveryKey!;
  await s.call({ type: 'lock' });
  await assert.rejects(s.call({ type: 'recover', recoveryKey: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', password: 'a brand new password' }), /recovery key/);
  await s.call({ type: 'recover', recoveryKey: key, password: 'a brand new password' });
  await s.call({ type: 'lock' });
  await assert.rejects(s.call({ type: 'unlock', password: PASSWORD }), /isn't right/);
  await s.call({ type: 'unlock', password: 'a brand new password' });
});

test('save, list and get: the list never carries a password, get does', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  const { rows } = await s.call<{ rows: Row[] }>({ type: 'list' });
  assert.deepEqual(rows, [{ id, name: 'Bank', username: 'me', sites: ['login.bank.com'], apps: 0, flagged: false }]);
  assert.ok(!JSON.stringify(rows).includes('pw-1'));
  const detail = await s.call<Detail>({ type: 'get', id });
  assert.equal(detail.password, 'pw-1');
  assert.equal(detail.websites, 'https://login.bank.com');
});

test('editing keeps the id and the app links; removing leaves a tombstone, not a hole', async () => {
  const s = await unlocked();
  const preview = await s.call<ImportPreview>({ type: 'import', csv: redacted, commit: true });
  assert.ok(preview.added > 0);
  const { rows } = await s.call<{ rows: Row[] }>({ type: 'list' });
  const app = rows.find((r) => r.apps > 0)!;
  await s.call({ type: 'save', id: app.id, login: login({ name: 'Renamed', websites: '' }) });
  const after = (await s.call<{ rows: Row[] }>({ type: 'list' })).rows.find((r) => r.id === app.id)!;
  assert.deepEqual([after.name, after.apps], ['Renamed', app.apps]);
  await s.call({ type: 'remove', id: app.id });
  assert.ok(!(await s.call<{ rows: Row[] }>({ type: 'list' })).rows.some((r) => r.id === app.id));
  assert.ok(s.store.records.has(app.id));
});

test('save asks for a name and a valid website instead of storing junk', async () => {
  const s = await unlocked();
  await assert.rejects(add(s, { name: ' ', websites: '' }), /name/i);
  await assert.rejects(add(s, { websites: 'not a url' }), /website address/);
});

test('a blank name falls back to the site', async () => {
  const s = await unlocked();
  await add(s, { name: '', websites: 'https://www.example.co.uk/login' });
  assert.equal((await s.call<{ rows: Row[] }>({ type: 'list' })).rows[0].name, 'example.co.uk');
});

test('import previews without writing, then commits every login in one go', async () => {
  const s = await unlocked();
  const preview = await s.call<ImportPreview>({ type: 'import', csv: redacted, commit: false });
  assert.deepEqual([preview.added, preview.merged, preview.flagged], [8, 1, 2]);
  assert.equal(s.store.records.size, 0);
  await s.call({ type: 'import', csv: redacted, commit: true });
  assert.equal(s.store.records.size, 8);
  assert.equal((await s.call<{ rows: Row[] }>({ type: 'list' })).rows.filter((r) => r.flagged).length, 2);
});

test('a file that is not a Google export is refused with the importer message', async () => {
  const s = await unlocked();
  await assert.rejects(s.call({ type: 'import', csv: 'a,b\n1,2', commit: true }), /isn't a Google Passwords export/);
  assert.equal(s.store.records.size, 0);
});

test('a web page may only ask for matching logins, fills and captures; everything else is refused', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  const ctx = page('https://login.bank.com/');
  for (const req of [{ type: 'list' }, { type: 'get', id }, { type: 'unlock', password: PASSWORD }, { type: 'lock' }, { type: 'status' },
    { type: 'save', id: null, login: login() }, { type: 'remove', id }, { type: 'import', csv: redacted, commit: true },
    { type: 'pending', tabId: 1 }, { type: 'resolvePending', tabId: 1, action: 'save' }, { type: 'confirmRecovery', group: 'AAAA' }]) {
    await assert.rejects(s.call(req, ctx), /isn't allowed/, req.type);
  }
  assert.ok(await s.call({ type: 'candidates' }, ctx));
});

test('export refuses a wrong master password', async () => {
  const s = await unlocked();
  await add(s);
  await assert.rejects(s.call({ type: 'export', password: 'not the master password' }), /isn't right/);
});

test('export refuses while locked', async () => {
  const s = await unlocked();
  await add(s);
  await s.call({ type: 'lock' });
  await assert.rejects(s.call({ type: 'export', password: PASSWORD }), /locked/);
});

test('export returns one row per site and counts logins without a website', async () => {
  const s = await unlocked();
  await add(s);
  await add(s, { name: 'Wifi', websites: '', password: 'pw-2', note: 'router' });
  const out = await s.call<{ csv: string; rows: number; leftOut: number }>({ type: 'export', password: PASSWORD });
  assert.deepEqual([out.rows, out.leftOut], [1, 1]);
  const lines = out.csv.trim().split(/\r?\n/);
  assert.equal(lines[0], 'name,url,username,password,note');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /login\.bank\.com/);
  assert.ok(!out.csv.includes('pw-2'));
});

test('export from a page context is refused, even for the right password', async () => {
  const s = await unlocked();
  await add(s);
  await assert.rejects(s.call({ type: 'export', password: PASSWORD }, page('https://login.bank.com/')), /isn't allowed/);
});

test('candidates are the logins saved for this site, never a lookalike or an http copy of an https login', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  await add(s, { name: 'Other', websites: 'https://other.org' });
  const names = async (url: string) => (await s.call<{ rows: Row[] }>({ type: 'candidates' }, page(url))).rows.map((r) => r.name);
  assert.deepEqual(await names('https://www.bank.com/'), ['Bank']);
  assert.deepEqual(await names('https://bank.com.evil.io/'), []);
  assert.deepEqual(await names('https://bank-com.example/'), []);
  assert.deepEqual(await names('http://login.bank.com/'), []);
  assert.deepEqual(await names('chrome://settings'), []);
  assert.ok(id);
});

test('while locked a page learns only that the vault is locked', async () => {
  const s = await unlocked();
  await add(s);
  await s.call({ type: 'lock' });
  assert.deepEqual(await s.call({ type: 'candidates' }, page('https://login.bank.com/')), { locked: true, rows: [] });
});

test('fill returns the credentials only for a login saved for the page the request came from', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  assert.deepEqual(await s.call({ type: 'fill', id }, page('https://login.bank.com/')), { username: 'me', password: 'pw-1' });
  await assert.rejects(s.call({ type: 'fill', id }, page('https://bank.com.evil.io/')), /isn't saved for this website/);
  await assert.rejects(s.call({ type: 'fill', id }, page('http://login.bank.com/')), /isn't saved for this website/);
  await assert.rejects(s.call({ type: 'fill', id: 'no-such-id' }, page('https://login.bank.com/')), /isn't saved for this website/);
  await assert.rejects(s.call({ type: 'fill', id }), /isn't allowed/);
});

test('fill never answers while locked', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  await s.call({ type: 'lock' });
  await assert.rejects(s.call({ type: 'fill', id }, page('https://login.bank.com/')), /locked/i);
});

test('fill is refused unless it comes from the page itself, so the popup cannot fill a page that changed since it looked', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  await assert.rejects(s.call({ type: 'fill', id, page: page('https://login.bank.com/') }), /isn't allowed/);
});

test('without a DeviceVault, a page-side fill still needs an unlocked session (existing behavior unchanged)', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  await s.call({ type: 'lock' });
  await assert.rejects(s.call({ type: 'fill', id }, page('https://login.bank.com/')), /locked/i);
});

test('after unlock, a fill works once the session is cleared: the device-held keys answer it', async () => {
  const s = await unlocked(deviceVault());
  const { id } = await add(s);
  await s.call({ type: 'lock' });
  assert.deepEqual(await s.call({ type: 'fill', id }, page('https://login.bank.com/')), { username: 'me', password: 'pw-1' });
});

test('a manual lock ends fills; the non-manual (auto-lock) request does not, though status still says locked', async () => {
  const s = await unlocked(deviceVault());
  const { id } = await add(s);
  await s.call({ type: 'lock' });
  assert.equal((await s.call<Status>({ type: 'status' })).state, 'locked');
  assert.deepEqual(await s.call({ type: 'fill', id }, page('https://login.bank.com/')), { username: 'me', password: 'pw-1' });

  await s.call({ type: 'lock', manual: true });
  assert.equal((await s.call<Status>({ type: 'status' })).state, 'locked');
  await assert.rejects(s.call({ type: 'fill', id }, page('https://login.bank.com/')), /locked/i);
});

test('candidates work from device keys with the popup locked, and a lookalike host is still refused', async () => {
  const s = await unlocked(deviceVault());
  const { id } = await add(s);
  await s.call({ type: 'lock' });
  const found = await s.call<{ locked: boolean; rows: Row[] }>({ type: 'candidates' }, page('https://login.bank.com/'));
  assert.deepEqual([found.locked, found.rows.map((r) => r.id)], [false, [id]]);
  await assert.rejects(s.call({ type: 'fill', id }, page('https://bank.com.evil.io/')), /isn't saved for this website/);
});

test('a page cannot reach export, get, list or save even while device keys answer fill, locked or not', async () => {
  const s = await unlocked(deviceVault());
  const { id } = await add(s);
  await s.call({ type: 'lock' });
  const ctx = page('https://login.bank.com/');
  for (const req of [{ type: 'export', password: PASSWORD }, { type: 'get', id }, { type: 'list' }, { type: 'save', id: null, login: login() }]) {
    await assert.rejects(s.call(req, ctx), /isn't allowed/, req.type);
  }
});

test('the recovery key is shown only while the vault is unlocked', async () => {
  const s = await unlocked();
  await s.call({ type: 'lock' });
  assert.equal((await s.call<Status>({ type: 'status' })).recoveryKey, null);
  await assert.rejects(s.call({ type: 'confirmRecovery', group: 'AAAA' }), /locked/i);
  await s.call({ type: 'unlock', password: PASSWORD });
  assert.ok((await s.call<Status>({ type: 'status' })).recoveryKey);
});

test('a master password that is one repeated character or a straight run is refused', async () => {
  for (const password of ['aaaaaaaaaaaa', '000000000000', 'abcdefghijkl', 'mnopqrstuvwx', 'zyxwvutsrqpo']) {
    await assert.rejects(setup().call({ type: 'setup', password }), /too common/, password);
  }
  await setup().call({ type: 'setup', password: 'abcdefghijkm' });
});

test('a captured sign-in for a new site is offered as a new login and saved on request', async () => {
  const s = await unlocked();
  await s.call({ type: 'capture', username: 'ann', password: 'secret-1' }, page('https://shop.example.com/login', 7));
  const pending = await s.call<Pending>({ type: 'pending', tabId: 7 });
  assert.deepEqual(pending, { intent: 'new', host: 'shop.example.com', username: 'ann', name: null, locked: false });
  assert.ok(!JSON.stringify(pending).includes('secret-1'));
  await s.call({ type: 'resolvePending', tabId: 7, action: 'save' });
  assert.equal(await s.call({ type: 'pending', tabId: 7 }), null);
  const { rows } = await s.call<{ rows: Row[] }>({ type: 'list' });
  assert.deepEqual(rows.map((r) => [r.name, r.username, r.sites]), [['example.com', 'ann', ['shop.example.com']]]);
  const detail = await s.call<Detail>({ type: 'get', id: rows[0].id });
  assert.equal(detail.password, 'secret-1');
});

test('a changed password for a saved username is offered as an update; the same password is not offered at all', async () => {
  const s = await unlocked();
  const { id } = await add(s);
  const at = page('https://login.bank.com/', 3);
  await s.call({ type: 'capture', username: 'me', password: 'pw-1' }, at);
  assert.equal(await s.call({ type: 'pending', tabId: 3 }), null);
  await s.call({ type: 'capture', username: 'ME', password: 'pw-2' }, at);
  assert.deepEqual(await s.call<Pending>({ type: 'pending', tabId: 3 }), { intent: 'update', host: 'login.bank.com', username: 'ME', name: 'Bank', locked: false });
  await s.call({ type: 'resolvePending', tabId: 3, action: 'save' });
  assert.equal((await s.call<Detail>({ type: 'get', id })).password, 'pw-2');
  assert.equal((await s.call<{ rows: Row[] }>({ type: 'list' })).rows.length, 1);
});

test('dismissing a pending save forgets it; captures with no password or on non-web pages are ignored', async () => {
  const s = await unlocked();
  await s.call({ type: 'capture', username: 'ann', password: 'x' }, page('https://shop.example.com/', 4));
  await s.call({ type: 'resolvePending', tabId: 4, action: 'dismiss' });
  assert.equal(await s.call({ type: 'pending', tabId: 4 }), null);
  await s.call({ type: 'capture', username: 'ann', password: '' }, page('https://shop.example.com/', 5));
  await s.call({ type: 'capture', username: 'ann', password: 'x' }, page('file:///tmp/login.html', 6));
  assert.equal(await s.call({ type: 'pending', tabId: 5 }), null);
  assert.equal(await s.call({ type: 'pending', tabId: 6 }), null);
});

test('an oversized capture is ignored, so a page cannot fill the session store', async () => {
  const s = await unlocked();
  await s.call({ type: 'capture', username: 'a'.repeat(2000), password: 'x' }, page('https://shop.example.com/', 11));
  await s.call({ type: 'capture', username: 'ann', password: 'x'.repeat(5000) }, page('https://shop.example.com/', 12));
  assert.equal(await s.call({ type: 'pending', tabId: 11 }), null);
  assert.equal(await s.call({ type: 'pending', tabId: 12 }), null);
});

test('a capture made while locked waits for the unlock, but expires after five minutes', async () => {
  const s = await unlocked();
  await s.call({ type: 'lock' });
  await s.call({ type: 'capture', username: 'ann', password: 'secret-1' }, page('https://shop.example.com/', 8));
  assert.deepEqual(await s.call<Pending>({ type: 'pending', tabId: 8 }), { intent: null, host: 'shop.example.com', username: 'ann', name: null, locked: true });
  await assert.rejects(s.call({ type: 'resolvePending', tabId: 8, action: 'save' }), /locked/i);
  await s.call({ type: 'unlock', password: PASSWORD });
  assert.equal((await s.call<Pending>({ type: 'pending', tabId: 8 })).intent, 'new');
  s.clock.t += 5 * 60_000 + 1;
  assert.equal(await s.call({ type: 'pending', tabId: 8 }), null);
});

test('locking wipes the vault key and every captured password; an unconfirmed recovery key waits in memory, unseen', async () => {
  const s = await unlocked();
  await s.call({ type: 'capture', username: 'ann', password: 'secret-1' }, page('https://shop.example.com/', 9));
  await s.call({ type: 'lock' });
  assert.ok(![...s.session.data.values()].some((v) => v.includes('secret-1')));
  assert.ok(![...s.session.data.keys()].includes('vaultKey'));
  assert.ok(s.session.data.has('recovery'));
  assert.equal((await s.call<Status>({ type: 'status' })).recoveryKey, null);
});

test('the auto-lock timer restarts on the owner\'s actions but not on a page asking for matches', async () => {
  const s = await unlocked();
  const base = s.timer.resets;
  assert.ok(base >= 1);
  await s.call({ type: 'candidates' }, page('https://login.bank.com/'));
  await s.call({ type: 'status' });
  assert.equal(s.timer.resets, base);
  await s.call({ type: 'list' });
  assert.equal(s.timer.resets, base + 1);
});

test('records that cannot be read are reported and left in place', async () => {
  const s = await unlocked();
  await add(s);
  s.store.records.set('broken', new Uint8Array(40).fill(1));
  const list = await s.call<{ rows: Row[]; unreadable: number }>({ type: 'list' });
  assert.equal(list.rows.length, 1);
  assert.equal(list.unreadable, 1);
  assert.ok(s.store.records.has('broken'));
});

test('setupRejectsCommonPassword', async () => {
  assert.equal(COMMON_PASSWORDS.size, 10);
  for (const common of COMMON_PASSWORDS) {
    for (const password of [common, common.toUpperCase(), common[0].toUpperCase() + common.slice(1)]) {
      const { call } = setup();
      await assert.rejects(call({ type: 'setup', password }), /too common/, password);
      assert.equal((await call<Status>({ type: 'status' })).state, 'no-vault');
    }
  }
  await assert.rejects(setup().call({ type: 'recover', recoveryKey: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', password: 'Masterbating' }), /too common/);
});

const NEW_PASSWORD = 'a second master password';
const THIRD_PASSWORD = 'a third master password';
const until = async (done: () => boolean) => {
  for (let i = 0; i < 500 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(done());
};

// Mirrors idbKeyStore's generate-on-first-use, but keyed on the fake chrome.storage.local so a restart (same local) keeps the same wrapper key, as the real IndexedDB would.
const deviceKeyStores = new WeakMap<ReturnType<typeof fakeChrome>, KeyStore>();
function deviceKeyStore(local: ReturnType<typeof fakeChrome>): KeyStore {
  let ks = deviceKeyStores.get(local);
  if (!ks) {
    let key: CryptoKey | undefined;
    ks = { get: async () => (key ??= await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])), put: async (k) => void (key = k) };
    deviceKeyStores.set(local, ks);
  }
  return ks;
}

function extension(world: World, local = fakeChrome()) {
  useChrome(local);
  const session = memoryKv();
  const alarms: boolean[] = [];
  const clock = { t: 1_000_000 };
  const device = createDeviceVault(localKv, deviceKeyStore(local));
  const store = createLocalStore(device);
  const service = createService({
    store, session, settings: localKv, now: () => clock.t, resetAutoLock() {}, syncAlarm: (on) => void alarms.push(on),
    sync: { store, transport: world.transport }, device, ...LOW,
  });
  const call = <T = unknown>(req: object, ctx?: Ctx) => service.handle(req as never, ctx) as Promise<T>;
  return { world, local, session, alarms, clock, service, store, device, call, restart: () => extension(world, local) };
}
type Ext = ReturnType<typeof extension>;

const signIn = (x: Ext, over: object = {}) => x.call({ type: 'signIn', password: PHONE_PASSWORD, accountKey: x.world.accountKeyText, ...over });
const recoverySignIn = (x: Ext, over: object = {}) =>
  x.call({ type: 'signInRecovery', recoveryKey: x.world.recoveryKeyText, newPassword: NEW_PASSWORD, accountKey: x.world.accountKeyText, ...over });
const names = async (x: Ext) => (await x.call<{ rows: Row[] }>({ type: 'list' })).rows.map((r) => r.name).sort();
const status = (x: Ext) => x.call<SyncStatus>({ type: 'syncStatus' });
const snapshot = (x: Ext) => JSON.stringify([...x.local.data]);
const headerNow = async (x: Ext) => headerToJson((await x.store.getHeader())!);

async function signedIn(world?: World) {
  const x = extension(world ?? (await newWorld()));
  assert.equal(await signIn(x), null);
  return x;
}

test('signInReplacesTheLocalVaultOnlyAfterConfirmation', async () => {
  const world = await newWorld();
  await world.phone.add('Mail');
  await world.phone.sync();
  const x = extension(world);
  await x.call({ type: 'setup', password: PASSWORD });
  await add(x);
  await add(x, { name: 'Second', websites: 'https://two.example' });
  const before = snapshot(x);
  assert.deepEqual(await signIn(x), { needsConfirm: true, entries: 2 });
  assert.equal(snapshot(x), before);
  assert.equal((await status(x)).state, 'off');

  x.local.setCalls.length = 0;
  assert.equal(await signIn(x, { replace: true }), null);
  const writes = x.local.setCalls.filter((keys) => keys.includes('header'));
  assert.equal(writes.length, 1);
  for (const key of ['records', 'quarantine', 'syncMeta']) assert.ok(writes[0].includes(key), key);
  assert.ok(x.local.setCalls.some((keys) => keys.includes('accountKeySealed')));
  assert.deepEqual(await names(x), ['Mail']);
  assert.equal(await headerNow(x), headerToJson(world.phone.store.header!));
  assert.deepEqual(await x.store.getSyncMeta(), { lastRev: 1, headerRev: 1 });
  assert.deepEqual((await x.store.getSyncLocal()).accountKey, world.accountKey);

  await x.call({ type: 'lock' });
  await assert.rejects(x.call({ type: 'unlock', password: PASSWORD }), /isn't right/);
  await x.call({ type: 'unlock', password: PHONE_PASSWORD });
  await x.service.settled();
  assert.equal((await status(x)).state, 'idle');
});

test('theConfirmationCountsWhatIsThereNotWhatWasDeleted', async () => {
  const x = extension(await newWorld());
  await x.call({ type: 'setup', password: PASSWORD });
  const { id } = await add(x);
  await add(x, { name: 'Second' });
  await add(x, { name: 'Third' });
  await x.call({ type: 'remove', id });
  assert.deepEqual(await signIn(x), { needsConfirm: true, entries: 2 });
  await x.call({ type: 'lock' });
  assert.deepEqual(await signIn(x), { needsConfirm: true, entries: 3 });
});

test('aServerHeaderThatDroppedTheAccountKeyFlagIsNeverTaken', async () => {
  const world = await newWorld();
  const x = extension(world);
  await x.call({ type: 'setup', password: PASSWORD });
  const before = snapshot(x);
  world.rewrite = (path, body) => (path === '/v1/records' ? { ...body, header: JSON.stringify({ ...JSON.parse(body.header), accountKey: undefined }) } : body);
  await assert.rejects(recoverySignIn(x, { replace: true }), /did not accept that recovery key/);
  await assert.rejects(signIn(x, { replace: true }), /password or account key/);
  assert.equal(snapshot(x), before);
});

test('signInAsksNothingWhenThereIsNothingToLose', async () => {
  const empty = extension(await newWorld());
  assert.equal(await signIn(empty), null);
  const withVault = extension(await newWorld());
  await withVault.call({ type: 'setup', password: PASSWORD });
  assert.equal(await signIn(withVault), null);
});

test('failedSignInKeepsTheOldVault', async () => {
  const world = await newWorld();
  const x = extension(world);
  await x.call({ type: 'setup', password: PASSWORD });
  await add(x, { name: 'Mine' });
  // deviceKeys is reread, not just the vault: each lock/unlock in the loop below reseals it with a fresh nonce, so it is left out of this comparison on purpose.
  const stable = () => JSON.stringify([...x.local.data].filter(([k]) => k !== 'deviceKeys'));
  const before = stable();
  const refused = async (over: object, message: RegExp) => {
    await assert.rejects(signIn(x, { replace: true, ...over }), message);
    assert.equal(stable(), before);
    assert.equal((await status(x)).state, 'off');
    await x.call({ type: 'lock' });
    await x.call({ type: 'unlock', password: PASSWORD });
    assert.deepEqual(await names(x), ['Mine']);
  };
  await refused({ password: 'not the password' }, /password or account key/);
  await refused({ accountKey: formatAccountKey(randomBytes(20)) }, /password or account key/);
  await refused({ accountKey: 'ABCD-EFGH' }, /account key isn't complete/);
  world.rewrite = (path, body) => (path === '/v1/prelogin' ? { ...body, kdf: { ...body.kdf, memoryKiB: 4_194_304 } } : body);
  await refused({}, /outside what Strongroom accepts/);
  world.rewrite = undefined;
  world.online = false;
  await refused({}, /could not be reached/);
  world.online = true;
  assert.equal(await signIn(x, { replace: true }), null);
  assert.deepEqual(await names(x), []);
});

test('syncMergesAndShowsRemoteEdits', async () => {
  const world = await newWorld();
  const mailId = await world.phone.add('Mail', 1000);
  await world.phone.sync();
  const x = await signedIn(world);
  assert.deepEqual(await names(x), ['Mail']);

  await world.phone.edit(mailId, loginEntry('Mail (work)', 5000));
  await world.phone.add('Bank');
  await world.phone.sync();
  assert.equal((await x.call<SyncReport>({ type: 'syncNow' })).pulled, 2);
  assert.deepEqual(await names(x), ['Bank', 'Mail (work)']);
  const shown = await status(x);
  assert.deepEqual([shown.state, shown.lastSyncAt, shown.pendingUpdate], ['idle', x.clock.t, false]);

  await add(x, { name: 'From the extension' });
  await x.service.settled();
  await world.phone.sync();
  assert.deepEqual(await world.phone.names(), ['Bank', 'From the extension', 'Mail (work)']);

  await world.phone.edit(mailId, { type: 'deleted', updatedAt: Date.now() });
  await world.phone.sync();
  await x.call({ type: 'syncNow' });
  assert.deepEqual(await names(x), ['Bank', 'From the extension']);
});

test('a manual lock clears the login token, the device-held keys, and stops syncing', async () => {
  const x = await signedIn();
  assert.ok(x.session.data.has('loginToken'));
  assert.equal(x.alarms.at(-1), true);
  await x.call({ type: 'lock', manual: true });
  assert.ok(!x.session.data.has('loginToken'));
  assert.ok(!x.session.data.has('vaultKey'));
  assert.equal(x.alarms.at(-1), false);

  const seen = x.world.requests.length;
  await assert.rejects(x.call({ type: 'syncNow' }), /locked/i);
  await x.service.settled();
  assert.equal(x.world.requests.length, seen);

  await x.call({ type: 'unlock', password: PHONE_PASSWORD });
  assert.ok(x.session.data.has('loginToken'));
  await x.call({ type: 'syncNow' });
  assert.ok(x.world.requests.length > seen);
});

test('sync runs from the device-held keys once the session is gone, after a plain (non-manual) lock', async () => {
  const x = await signedIn();
  assert.equal(x.alarms.at(-1), true);
  await x.call({ type: 'lock' });
  assert.ok(!x.session.data.has('loginToken'));
  assert.ok(!x.session.data.has('vaultKey'));
  assert.ok(await x.device.loadKeys());
  // A plain lock leaves background sync running, unlike a manual one: the sync alarm is not turned off.
  assert.equal(x.alarms.at(-1), true);

  const seen = x.world.requests.length;
  const report = await x.call<{ pulled: number }>({ type: 'syncNow' });
  assert.ok(report);
  assert.ok(x.world.requests.length > seen);
});

test('pageContextCannotSignInOrSync', async () => {
  const x = extension(await newWorld());
  const ctx = page('https://login.bank.com/');
  for (const req of [{ type: 'syncStatus' }, { type: 'signIn', password: PHONE_PASSWORD, accountKey: x.world.accountKeyText, replace: true },
    { type: 'signInRecovery', recoveryKey: x.world.recoveryKeyText, newPassword: NEW_PASSWORD, accountKey: x.world.accountKeyText }, { type: 'syncNow' }]) {
    await assert.rejects(x.call(req, ctx), /isn't allowed/, req.type);
  }
  assert.deepEqual(x.world.requests, []);
});

test('syncIsUnavailableWithoutAServerUrl', async () => {
  const s = setup();
  assert.deepEqual(await s.call({ type: 'syncStatus' }), { available: false, state: 'off', lastSyncAt: null, blocked: 0, quarantined: 0, pendingUpdate: false, error: null, keyLost: false });
  for (const req of [{ type: 'signIn', password: PHONE_PASSWORD, accountKey: 'x' }, { type: 'signInRecovery', recoveryKey: 'x', newPassword: NEW_PASSWORD, accountKey: 'x' }, { type: 'syncNow' }]) {
    await assert.rejects(s.call(req), /isn't available in this build/, req.type);
  }
});

test('aVaultThatNeedsAnAccountKeyThisComputerLostSaysSo', async () => {
  const x = await signedIn();
  await x.call({ type: 'lock' });
  assert.equal((await status(x)).keyLost, false);
  x.local.data.delete('accountKeySealed'); // the sealed entry is the only copy once signed in, same as losing it from storage
  await assert.rejects(x.call({ type: 'unlock', password: PHONE_PASSWORD }), /Sign in with your account/);
  const lost = await status(x);
  assert.deepEqual([lost.state, lost.keyLost], ['off', true]);
  assert.equal(await signIn(x), null);
  assert.deepEqual([(await status(x)).state, (await status(x)).keyLost], ['idle', false]);
});

test('recoverySignInRefusesAKeyThatIsNotTheOneThisComputerHolds', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  const before = snapshot(x);
  world.requests.length = 0;
  await assert.rejects(recoverySignIn(x, { accountKey: formatAccountKey(randomBytes(20)) }), /account key doesn't match the one this computer uses/);
  assert.deepEqual(world.requests, []);
  assert.equal(snapshot(x), before);
  assert.equal(await recoverySignIn(x), null);
});

test('aRecoveryMadeWhileASyncIsSendingAnOlderUpdateWaitsForIt', async () => {
  const world = await newWorld();
  const x = extension(world);
  world.failPut = true;
  await recoverySignIn(x);
  world.failPut = false;
  let release = () => {};
  world.gate = new Promise<void>((resolve) => (release = resolve));
  const syncing = x.call({ type: 'syncNow' });
  await until(() => world.requests.includes('PUT /v1/account'));
  const stored = x.store.setAccount;
  const written = new Promise<void>((resolve) => (x.store.setAccount = async (a) => (await stored(a), resolve())));
  const recovering = x.call({ type: 'recover', recoveryKey: world.recoveryKeyText, password: THIRD_PASSWORD });
  await Promise.race([written, new Promise((resolve) => setTimeout(resolve, 2500))]);
  x.store.setAccount = stored;
  release();
  await Promise.all([syncing, recovering]);
  await x.service.settled();

  const landed = await status(x);
  assert.deepEqual([landed.state, landed.pendingUpdate], ['idle', false]);
  assert.ok(await signInWithPassword(world.phone.transport, THIRD_PASSWORD, world.accountKey));
  await x.call({ type: 'lock' });
  await x.call({ type: 'unlock', password: THIRD_PASSWORD });
  await x.call({ type: 'syncNow' });
});

test('recoverySignInReplacesOnlyAfterConfirmation', async () => {
  const x = extension(await newWorld());
  await x.call({ type: 'setup', password: PASSWORD });
  await add(x);
  const before = snapshot(x);
  assert.deepEqual(await recoverySignIn(x), { needsConfirm: true, entries: 1 });
  assert.equal(snapshot(x), before);
  assert.equal(await recoverySignIn(x, { replace: true }), null);
  assert.deepEqual(await names(x), []);
});

test('recoverySignInUpdatesTheServerWithTheNewPassword', async () => {
  const world = await newWorld();
  await world.phone.add('Mail');
  await world.phone.sync();
  const x = extension(world);
  assert.equal(await recoverySignIn(x), null);
  assert.deepEqual(await names(x), ['Mail']);
  const shown = await status(x);
  assert.deepEqual([shown.state, shown.pendingUpdate], ['idle', false]);

  const again = await signInWithPassword(world.phone.transport, NEW_PASSWORD, world.accountKey);
  assert.deepEqual(again.vaultKey, world.phone.vaultKey);
  assert.deepEqual(await x.store.getSyncMeta(), { lastRev: 1, headerRev: again.headerRev });
  await assert.rejects(signInWithPassword(world.phone.transport, PHONE_PASSWORD, world.accountKey), SyncAuthError);
  assert.ok(await signInWithRecovery(world.phone.transport, world.recoveryKey));
  const row = world.sqlite.prepare('SELECT recovery_hash FROM account').get() as { recovery_hash: string };
  assert.equal(row.recovery_hash, tokenHash(recoveryLoginToken(world.recoveryKey)));

  await x.call({ type: 'lock' });
  await x.call({ type: 'unlock', password: NEW_PASSWORD });
  await x.call({ type: 'syncNow' });
});

test('recoverySignInKeepsAPendingUpdateUntilItLands', async () => {
  const world = await newWorld();
  const x = extension(world);
  world.failPut = true;
  assert.equal(await recoverySignIn(x), null);
  assert.equal((await status(x)).pendingUpdate, true);

  world.requests.length = 0;
  await assert.rejects(x.call({ type: 'syncNow' }), /could not be reached/);
  assert.deepEqual(world.requests, ['PUT /v1/account']);
  assert.ok(!snapshot(x).includes(toBase64(recoveryLoginToken(world.recoveryKey))));

  const y = x.restart();
  world.requests.length = 0;
  await y.call({ type: 'unlock', password: NEW_PASSWORD });
  await y.service.settled();
  assert.deepEqual(world.requests, ['PUT /v1/account']);
  assert.equal((await status(y)).pendingUpdate, true);

  world.failPut = false;
  await y.call({ type: 'syncNow' });
  const landed = await status(y);
  assert.deepEqual([landed.state, landed.pendingUpdate], ['idle', false]);
  assert.ok(await signInWithPassword(world.phone.transport, NEW_PASSWORD, world.accountKey));
});

test('aRefusedTokenAsksToSignInButKeepsThePendingUpdate', async () => {
  const world = await newWorld();
  const x = extension(world);
  world.failPut = true;
  await recoverySignIn(x);
  world.failPut = false;
  world.sqlite.exec("UPDATE account SET recovery_hash = 'a recovery key replaced elsewhere'");

  await assert.rejects(x.call({ type: 'syncNow' }), /Sign in again/);
  const refused = await status(x);
  assert.deepEqual([refused.state, refused.pendingUpdate], ['needsSignIn', true]);
  const seen = world.requests.length;
  await assert.rejects(x.call({ type: 'syncNow' }), /Sign in again/);
  assert.equal(world.requests.length, seen);

  assert.equal(await signIn(x, { replace: true }), null);
  const after = await status(x);
  assert.deepEqual([after.state, after.pendingUpdate], ['idle', false]);
});

test('aLocalRecoveryOnASignedInExtensionQueuesTheServerUpdate', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await x.call({ type: 'lock' });
  await x.call({ type: 'recover', recoveryKey: world.recoveryKeyText, password: NEW_PASSWORD });
  await x.service.settled();
  assert.equal((await status(x)).pendingUpdate, false);
  assert.ok(await signInWithPassword(world.phone.transport, NEW_PASSWORD, world.accountKey));
  await x.call({ type: 'lock' });
  await x.call({ type: 'unlock', password: NEW_PASSWORD });
  await x.call({ type: 'syncNow' });
});

test('aHeaderChangedElsewhereIsAdoptedOnlyAtAPasswordUnlock', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  const changed = { ...world.phone.store.header!, recoveryWrap: randomBytes(60) };
  await world.phone.putHeader(changed, tokenHash(world.tokens.loginToken));

  assert.equal((await x.call<SyncReport>({ type: 'syncNow' })).headerChanged, true);
  assert.notEqual(await headerNow(x), headerToJson(changed));
  await x.call({ type: 'lock' });
  await x.call({ type: 'unlock', password: PHONE_PASSWORD });
  await x.service.settled();
  assert.equal(await headerNow(x), headerToJson(changed));
  assert.equal((await x.store.getSyncMeta()).headerRev, 2);
  assert.equal((await status(x)).state, 'idle');
});

test('aHeaderThatDoesNotOpenToThisVaultKeyIsNeverAdopted', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  const before = await headerNow(x);
  const other = await createVault(PHONE_PASSWORD, randomBytes(20), { kdf: KDF_FLOOR, accountKey: world.accountKey });
  await world.phone.putHeader(other.header, tokenHash(world.tokens.loginToken));
  await x.call({ type: 'lock' });
  await x.call({ type: 'unlock', password: PHONE_PASSWORD });
  await x.service.settled();
  assert.equal(await headerNow(x), before);
  assert.equal((await x.store.getSyncMeta()).headerRev, 1);
});

test('aRefusedTokenAsksToSignInAndStopsRetrying', async () => {
  const world = await newWorld();
  await world.phone.add('Mail');
  await world.phone.sync();
  const x = await signedIn(world);
  await world.phone.changePassword(NEW_PASSWORD);

  await add(x, { name: 'Written before the 401' });
  await x.service.settled();
  assert.equal((await status(x)).state, 'needsSignIn');
  const seen = world.requests.length;
  await assert.rejects(x.call({ type: 'syncNow' }), /Sign in again/);
  await x.call({ type: 'lock' });
  await x.call({ type: 'unlock', password: PHONE_PASSWORD });
  await x.service.settled();
  assert.equal(world.requests.length, seen);

  assert.equal(await signIn(x, { password: NEW_PASSWORD }), null);
  assert.equal((await status(x)).state, 'idle');
  assert.deepEqual(await names(x), ['Mail', 'Written before the 401']);
  await world.phone.sync();
  assert.deepEqual(await world.phone.names(), ['Mail', 'Written before the 401']);
});

const codeOf = (text: string) => /code is ([A-Z2-7-]+)\./.exec(text)![1];
const enrol = (x: Ext, email = 'me@example.com') => x.call<{ recoveryKey: string }>({ type: 'emailRecovery', action: 'enrol', email, password: PHONE_PASSWORD });
const emailStatus = (x: Ext) => x.call<EmailRecoveryStatus>({ type: 'emailRecovery', action: 'status' });

test('enrol rotates the recovery key: the new key opens the vault, the old one does not', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  const { recoveryKey } = await enrol(x);
  const header = (await x.store.getHeader())!;
  assert.ok(await unlockWithRecovery(header, parseRecoveryKey(recoveryKey)!));
  assert.equal(await unlockWithRecovery(header, world.recoveryKey), null);
});

test('enrol sends the code to the mailer once and the server never stores it', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await enrol(x);
  assert.equal(world.mail.sent.length, 1);
  assert.equal(world.mail.sent[0].to, 'me@example.com');
  const code = codeOf(world.mail.sent[0].text);
  const row = await world.env.DB.prepare('SELECT blob FROM escrow WHERE id = 1').first<{ blob: string }>();
  assert.ok(!row!.blob.includes(code));
});

test('enrol needs sync signed in', async () => {
  const x = extension(await newWorld());
  await x.call({ type: 'setup', password: PASSWORD });
  await assert.rejects(enrol(x), /Sign in to sync/);
});

test('enrol needs the vault unlocked', async () => {
  const x = await signedIn();
  await x.call({ type: 'lock' });
  await assert.rejects(enrol(x), /locked/i);
});

test('confirm with the right code marks it enrolled', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await enrol(x);
  const before = await emailStatus(x);
  assert.deepEqual([before.enrolled, before.waitingForCode], [false, true]);
  await x.call({ type: 'emailRecovery', action: 'confirm', code: codeOf(world.mail.sent[0].text) });
  const after = await emailStatus(x);
  assert.deepEqual([after.enrolled, after.waitingForCode], [true, false]);
});

test('confirm with a wrong code does not', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await enrol(x);
  await assert.rejects(x.call({ type: 'emailRecovery', action: 'confirm', code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' }), /isn't right/);
  assert.equal((await emailStatus(x)).enrolled, false);
});

test('off deletes the escrow', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await enrol(x);
  await x.call({ type: 'emailRecovery', action: 'confirm', code: codeOf(world.mail.sent[0].text) });
  await x.call({ type: 'emailRecovery', action: 'off' });
  assert.equal(await world.env.DB.prepare('SELECT 1 FROM escrow WHERE id = 1').first(), null);
  assert.equal((await emailStatus(x)).enrolled, false);
});

test('status shows wasTurnedOff after the server drops the escrow', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await enrol(x);
  await x.call({ type: 'emailRecovery', action: 'confirm', code: codeOf(world.mail.sent[0].text) });

  // Simulates a recovery-key rotation landing from another device: same header, a recoveryHash that no longer matches the sealed escrow.
  const header = (await x.store.getHeader())!;
  const { headerRev } = await x.store.getSyncMeta();
  await world.phone.transport.putAccount(world.phone.token, {
    header: headerToJson(header), loginHash: tokenHash(world.phone.token), readHash: world.phone.readHash,
    recoveryHash: tokenHash(randomBytes(32)), ifRev: headerRev,
  });

  const after = await emailStatus(x);
  assert.deepEqual([after.enrolled, after.wasTurnedOff], [false, true]);
});

test('status shows a pending recovery and cancelRecovery clears it', async () => {
  const world = await newWorld();
  const x = await signedIn(world);
  await enrol(x);
  await x.call({ type: 'emailRecovery', action: 'confirm', code: codeOf(world.mail.sent[0].text) });

  await world.phone.transport.lostRequest(tokenHash(randomBytes(32)));
  assert.deepEqual((await emailStatus(x)).pendingRecovery, { releaseAt: null });

  await x.call({ type: 'emailRecovery', action: 'cancelRecovery' });
  assert.equal((await emailStatus(x)).pendingRecovery, null);
});

test('enrol on a genuine 409 (the header changed elsewhere) pulls, adopts it, and a second attempt succeeds', async () => {
  const world = await newWorld();
  const x = await signedIn(world);

  // The phone rotates its own recovery key directly against the server: a real header change x does not yet know about.
  const rotatedByPhone = await rotateRecoveryKey(world.phone.store.header!, world.phone.vaultKey);
  const { headerRev, lastRev } = await world.phone.store.getSyncMeta();
  const put = await world.phone.transport.putAccount(world.phone.token, {
    header: headerToJson(rotatedByPhone.header), loginHash: tokenHash(world.phone.token), readHash: world.phone.readHash,
    recoveryHash: rotatedByPhone.recoveryHash, ifRev: headerRev,
  });
  await world.phone.store.applyPull({ header: rotatedByPhone.header, headerRev: put.headerRev, records: [], quarantine: [], rebase: [], lastRev });

  await assert.rejects(enrol(x), /changed on another device/);
  assert.equal(await headerNow(x), headerToJson(rotatedByPhone.header));
  assert.equal((await x.store.getSyncMeta()).headerRev, put.headerRev);
  assert.equal((await status(x)).state, 'idle');

  const { recoveryKey } = await enrol(x);
  assert.ok(await unlockWithRecovery((await x.store.getHeader())!, parseRecoveryKey(recoveryKey)!));
});

test('none of the email-recovery requests work from a page', async () => {
  const { call } = await unlocked();
  for (const action of ['status', 'enrol', 'confirm', 'off', 'cancelRecovery']) {
    await assert.rejects(call({ type: 'emailRecovery', action, email: 'a@b.com', password: PASSWORD, code: 'x' }, page('https://example.com')), /isn't allowed/);
  }
});

async function emailEnrolled() {
  const world = await newWorld();
  const owner = await signedIn(world);
  await enrol(owner);
  const code = codeOf(world.mail.sent[0].text);
  await owner.call({ type: 'emailRecovery', action: 'confirm', code });
  return { world, code };
}

type LostAccessState = { state: 'none' } | { state: 'waiting'; releaseAt: number | null } | { state: 'ready' };
const lostCheck = (x: Ext) => x.call<LostAccessState>({ type: 'lostAccess', action: 'check' });
const lostRequestNow = (x: Ext) => x.call({ type: 'lostAccess', action: 'request' });
// Simulates the account owner clicking the confirm link mailed by the server's lost/request, which starts the 24-hour wait.
async function confirmByEmail(world: World) {
  const token = /t=([^&\s]+)/.exec(world.mail.sent.at(-1)!.text)![1];
  await world.serve(new Request('https://vault.example/v1/lost/confirm?t=' + token));
}
// Backdates the confirmed request's release time instead of a fake clock: the 24-hour wait is counted from real release_at, so this ends it early.
const releaseLostRequest = (world: World) => world.sqlite.exec(`UPDATE lost_request SET release_at = ${Date.now() - 1000}`);

test('a fresh device can request, wait, then open with the code and ends signed in with a new password', async () => {
  const { world, code } = await emailEnrolled();
  const fresh = extension(world);
  assert.deepEqual(await lostCheck(fresh), { state: 'none' });
  await lostRequestNow(fresh);
  assert.deepEqual(await lostCheck(fresh), { state: 'waiting', releaseAt: null });
  await confirmByEmail(world);
  const waiting = await lostCheck(fresh);
  assert.equal(waiting.state, 'waiting');
  assert.ok((waiting as { releaseAt: number }).releaseAt > Date.now());
  releaseLostRequest(world);
  assert.deepEqual(await lostCheck(fresh), { state: 'ready' });
  assert.equal(await fresh.call({ type: 'lostAccess', action: 'open', code, newPassword: NEW_PASSWORD }), null);
  assert.equal((await fresh.call<Status>({ type: 'status' })).state, 'unlocked');
  assert.deepEqual((await fresh.store.getSyncLocal()).accountKey, world.accountKey);
  assert.ok(!fresh.local.data.has('lostClaim'));
  assert.ok(!fresh.local.data.has('lostBlob'));
  await fresh.call({ type: 'lock', manual: true });
  await fresh.call({ type: 'unlock', password: NEW_PASSWORD });
  assert.equal((await fresh.call<Status>({ type: 'status' })).state, 'unlocked');
});

test('check before 24 hours reports waiting', async () => {
  const { world } = await emailEnrolled();
  const fresh = extension(world);
  await lostRequestNow(fresh);
  await confirmByEmail(world);
  const waiting = await lostCheck(fresh);
  assert.equal(waiting.state, 'waiting');
  assert.ok(typeof (waiting as { releaseAt: number | null }).releaseAt === 'number');
});

test('a wrong code leaves the claim and blob in place and says so in plain words', async () => {
  const { world } = await emailEnrolled();
  const fresh = extension(world);
  await lostRequestNow(fresh);
  await confirmByEmail(world);
  releaseLostRequest(world);
  assert.deepEqual(await lostCheck(fresh), { state: 'ready' });
  await assert.rejects(
    fresh.call({ type: 'lostAccess', action: 'open', code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', newPassword: NEW_PASSWORD }),
    /isn't right/,
  );
  assert.ok(fresh.local.data.has('lostClaim'));
  assert.ok(fresh.local.data.has('lostBlob'));
  assert.deepEqual(await lostCheck(fresh), { state: 'ready' });
});

test('open without a ready blob is refused', async () => {
  const { world, code } = await emailEnrolled();
  const fresh = extension(world);
  await assert.rejects(fresh.call({ type: 'lostAccess', action: 'open', code, newPassword: NEW_PASSWORD }), /wait/i);
  await lostRequestNow(fresh);
  await assert.rejects(fresh.call({ type: 'lostAccess', action: 'open', code, newPassword: NEW_PASSWORD }), /wait/i);
  await confirmByEmail(world);
  await assert.rejects(fresh.call({ type: 'lostAccess', action: 'open', code, newPassword: NEW_PASSWORD }), /wait/i);
});

test('lostAccess refuses to run while the vault is unlocked', async () => {
  const { world } = await emailEnrolled();
  const x = extension(world);
  await x.call({ type: 'setup', password: PASSWORD });
  for (const req of [{ action: 'request' }, { action: 'check' }, { action: 'open', code: 'x', newPassword: NEW_PASSWORD }]) {
    await assert.rejects(x.call({ type: 'lostAccess', ...req }), /already unlocked/);
  }
});

test('lostAccess is refused from a page', async () => {
  const { call } = await unlocked();
  for (const action of ['request', 'check', 'open']) {
    await assert.rejects(call({ type: 'lostAccess', action, code: 'x', newPassword: NEW_PASSWORD }, page('https://example.com')), /isn't allowed/);
  }
});

test('after open the old recovery key is the rotated one (the pasted blob key works, an earlier key does not)', async () => {
  const { world, code } = await emailEnrolled();
  const fresh = extension(world);
  await lostRequestNow(fresh);
  await confirmByEmail(world);
  releaseLostRequest(world);
  await lostCheck(fresh);
  assert.equal(await fresh.call({ type: 'lostAccess', action: 'open', code, newPassword: NEW_PASSWORD }), null);
  const header = (await fresh.store.getHeader())!;
  assert.equal(await unlockWithRecovery(header, world.recoveryKey), null);
});
