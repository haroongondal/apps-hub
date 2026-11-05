import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadPublicSuffixList } from 'strongroom-core';
import type { Header, RecordStore, StoredRecord } from 'strongroom-core';
import { createService } from '../service.ts';
import type { Ctx, Detail, ImportPreview, KV, Pending, Row, Status } from '../service.ts';

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

function setup() {
  const store = new MemoryStore();
  const session = memoryKv();
  const clock = { t: 1_000_000 };
  const timer = { resets: 0 };
  const service = createService({ store, session, now: () => clock.t, resetAutoLock: () => timer.resets++, ...LOW });
  const call = <T>(req: object, ctx?: Ctx) => service.handle(req as never, ctx) as Promise<T>;
  return { store, session, clock, timer, service, call };
}

async function unlocked() {
  const s = setup();
  await s.call({ type: 'setup', password: PASSWORD });
  return s;
}

const page = (url: string, tabId = 1): Ctx => ({ url, tabId });
const login = (over: object = {}) => ({ name: 'Bank', username: 'me', password: 'pw-1', websites: 'https://login.bank.com/signin', note: '', ...over });
const add = <T = { id: string }>(s: Awaited<ReturnType<typeof unlocked>>, over: object = {}) => s.call<T>({ type: 'save', id: null, login: login(over) });

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
