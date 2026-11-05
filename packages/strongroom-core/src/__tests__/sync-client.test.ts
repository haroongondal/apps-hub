import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from '../crypto.ts';
import type { Entry } from '../entry.ts';
import { headerToJson, openEntry, sealEntry, toBase64 } from '../format.ts';
import type { Header } from '../format.ts';
import { syncOnce } from '../sync/client.ts';
import type { PullResponse, PushRequest, WireRecord } from '../sync/protocol.ts';
import { SyncAuthError, SyncHttpError, SyncOfflineError, SyncRollbackError } from '../sync/transport.ts';
import type { Transport } from '../sync/transport.ts';
import { MemorySyncStore } from './memory-sync-store.ts';

const T = 1_800_000_000_000;
const vaultKey = randomBytes(32);
const HEADER: Header = { version: 1, kdf: { memoryKiB: 65536, iterations: 3, parallelism: 1 }, salt: new Uint8Array(16), passwordWrap: new Uint8Array(60), recoveryWrap: new Uint8Array(60), accountKey: true };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const login = (name: string, updatedAt = T): Entry => ({ type: 'login', name, username: 'me', password: 'pw', sites: [], apps: [], note: '', updatedAt });
const seal = (n: number, e: Entry = login(`entry ${n}`)) => sealEntry(vaultKey, id(n), e);

async function device(lastRev = 0) {
  const store = new MemorySyncStore();
  store.header = HEADER;
  store.meta = { lastRev, headerRev: 1 };
  return store;
}

// A server with the Worker's rules: one global rev counter, a stale baseRev is a 409 and nothing is written.
function server() {
  const rows = new Map<string, WireRecord>();
  let latestRev = 0;
  const calls: string[] = [];
  let header = headerToJson(HEADER);
  const put = (rid: string, sealed: Uint8Array) => rows.set(rid, { id: rid, rev: ++latestRev, ciphertext: toBase64(sealed), updatedAt: T });
  const t: Transport = {
    prelogin: async () => null,
    async pull(_token, since): Promise<PullResponse> {
      calls.push(`pull ${since}`);
      return { header, headerRev: 1, records: [...rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev), latestRev, more: false };
    },
    async push(_token, req: PushRequest) {
      calls.push(`push ${req.upserts.map((u) => `${u.id.slice(-2)}@${u.baseRev}`).join(' ')}`);
      const conflicts = req.upserts.filter((u) => (rows.get(u.id)?.rev ?? 0) !== u.baseRev).map((u) => ({ id: u.id, rev: rows.get(u.id)?.rev ?? 0 }));
      if (conflicts.length) return { conflicts };
      for (const u of req.upserts) rows.set(u.id, { id: u.id, rev: ++latestRev, ciphertext: u.ciphertext, updatedAt: T });
      return { revs: req.upserts.map((u) => ({ id: u.id, rev: rows.get(u.id)!.rev })), latestRev };
    },
    putAccount: async () => {
      throw new Error('not used');
    },
  };
  return { t, rows, calls, put, setHeader: (h: string) => (header = h) };
}

const sync = (store: MemorySyncStore, t: Transport, maxRetries?: number) => syncOnce({ store, transport: t, vaultKey, token: new Uint8Array(32), maxRetries });
const entries = async (store: MemorySyncStore): Promise<Record<string, any>> =>
  Object.fromEntries(await Promise.all([...store.records].map(async ([rid, r]) => [rid, { ...(await openEntry(vaultKey, rid, r.sealed)), rev: r.rev, dirty: r.dirty }])));

test('freshDeviceOnlyPulls', async () => {
  const s = server();
  for (const n of [1, 2, 3]) s.put(id(n), await seal(n));
  const store = await device();
  const report = await sync(store, s.t);
  assert.deepEqual(report, { pulled: 3, pushed: 0, conflicts: 0, quarantined: 0, blocked: 0, headerChanged: false });
  assert.deepEqual(s.calls, ['pull 0']);
  const got = await entries(store);
  assert.deepEqual(Object.keys(got).sort(), [id(1), id(2), id(3)]);
  for (const e of Object.values(got)) assert.deepEqual([e.type, e.dirty], ['login', false]);
  assert.deepEqual(store.meta, { lastRev: 3, headerRev: 1 });
});

test('pullsInPagesAndAdvancesLastRevOnlyWithTheBatch', async () => {
  const wire = async (n: number): Promise<WireRecord> => ({ id: id(n), rev: n + 4, ciphertext: toBase64(await seal(n)), updatedAt: T });
  const pages = [
    { header: headerToJson(HEADER), headerRev: 1, records: [await wire(1), await wire(2)], latestRev: 7, more: true },
    { header: headerToJson(HEADER), headerRev: 1, records: [await wire(3)], latestRev: 7, more: false },
  ];
  const since: number[] = [];
  let failSecond = true;
  const t = (): Transport => ({
    ...server().t,
    async pull(_token, from) {
      since.push(from);
      if (from === 6 && failSecond) throw new SyncOfflineError();
      return from === 4 ? pages[0] : pages[1];
    },
  });
  const store = await device(4);
  await assert.rejects(sync(store, t()), SyncOfflineError);
  assert.deepEqual(store.meta, { lastRev: 4, headerRev: 1 });
  assert.equal(store.records.size, 0);
  assert.equal(store.writes, 0);
  failSecond = false;
  assert.equal((await sync(store, t())).pulled, 3);
  assert.deepEqual(since, [4, 6, 4, 6]);
  assert.deepEqual(store.meta, { lastRev: 7, headerRev: 1 });
  assert.equal(store.records.size, 3);
  assert.equal(store.writes, 1);
});

test('pushRetriesAfter409UpToMaxRetries', async () => {
  const s = server();
  const store = await device();
  await store.commit({ records: [{ id: id(1), sealed: await seal(1) }] });
  let refusals = 2;
  const flaky: Transport = { ...s.t, push: async (token, req) => (refusals-- > 0 ? { conflicts: [{ id: id(1), rev: 0 }] } : s.t.push(token, req)) };
  assert.equal((await sync(store, flaky, 3)).pushed, 1);
  assert.equal(s.calls.filter((c) => c.startsWith('pull')).length, 3);
  assert.equal(store.records.get(id(1))?.dirty, false);

  const other = await device();
  await other.commit({ records: [{ id: id(2), sealed: await seal(2) }] });
  let pushes = 0;
  const never: Transport = { ...s.t, push: async () => (pushes++, { conflicts: [{ id: id(2), rev: 0 }] }) };
  await assert.rejects(sync(other, never, 2), (e: unknown) => e instanceof SyncHttpError && e.status === 409);
  assert.equal(pushes, 3);
  assert.equal(other.records.get(id(2))?.dirty, true);
});

test('markPushedKeepsEditsMadeDuringThePush', async () => {
  const s = server();
  const store = await device();
  await store.commit({ records: [{ id: id(1), sealed: await seal(1) }, { id: id(2), sealed: await seal(2) }] });
  const edited = await seal(1, login('edited while pushing', T + 1));
  const racing: Transport = {
    ...s.t,
    async push(token, req) {
      await store.commit({ records: [{ id: id(1), sealed: edited }] });
      return s.t.push(token, req);
    },
  };
  assert.equal((await sync(store, racing)).pushed, 2);
  assert.deepEqual(store.records.get(id(1)), { sealed: edited, rev: 1, dirty: true });
  assert.equal(store.records.get(id(2))?.dirty, false);
  const next = await sync(store, s.t);
  assert.deepEqual([next.pushed, next.conflicts], [1, 0]);
  assert.deepEqual(store.records.get(id(1)), { sealed: edited, rev: 3, dirty: false });
});

test('interruptedPushIsNotAConflict', async () => {
  const s = server();
  const store = await device();
  const sealed = await seal(1);
  await store.commit({ records: [{ id: id(1), sealed }] });
  s.put(id(1), sealed);
  const report = await sync(store, s.t);
  assert.deepEqual(report, { pulled: 1, pushed: 0, conflicts: 0, quarantined: 0, blocked: 0, headerChanged: false });
  assert.deepEqual(s.calls, ['pull 0']);
  assert.deepEqual(store.records.get(id(1)), { sealed, rev: 1, dirty: false });
});

test('authFailureStopsAndAsksToSignIn', async () => {
  const store = await device(5);
  await store.commit({ records: [{ id: id(1), sealed: await seal(1) }] });
  const writes = store.writes;
  let calls = 0;
  const refused: Transport = {
    ...server().t,
    pull: async () => {
      calls++;
      throw new SyncAuthError();
    },
  };
  await assert.rejects(sync(store, refused), SyncAuthError);
  assert.equal(calls, 1);
  assert.equal(store.writes, writes);
});

test('rollbackIsReportedAndDeletesNothing', async () => {
  const s = server();
  s.put(id(1), await seal(1));
  const store = await device(10);
  await store.commit({ records: [{ id: id(2), sealed: await seal(2) }] });
  const before = await entries(store);
  await assert.rejects(sync(store, s.t), SyncRollbackError);
  assert.equal(store.writes, 1);
  assert.deepEqual(await entries(store), before);
  assert.deepEqual(store.meta, { lastRev: 10, headerRev: 1 });
  assert.deepEqual(s.calls, ['pull 10']);

  const headerBack = await device(0);
  headerBack.meta.headerRev = 2;
  await assert.rejects(sync(headerBack, s.t), SyncRollbackError);
  assert.equal(headerBack.writes, 0);
});

test('badRowsAreSkippedAndReported', async () => {
  const good = { id: id(1), rev: 1, ciphertext: toBase64(await seal(1)), updatedAt: T };
  const records = [
    good,
    { id: 'ABCDEF00-0000-4000-8000-000000000002', rev: 2, ciphertext: good.ciphertext, updatedAt: T },
    { id: id(3), rev: 3, ciphertext: 'A'.repeat(90_004), updatedAt: T },
    { id: id(4), rev: 4, ciphertext: 'not*base64', updatedAt: T },
  ];
  const t: Transport = { ...server().t, pull: async () => ({ header: headerToJson(HEADER), headerRev: 1, records, latestRev: 4, more: false }) };
  const store = await device();
  await store.commit({ records: [{ id: id(3), sealed: await seal(3) }] });
  const report = await sync(store, t);
  assert.deepEqual(report, { pulled: 1, pushed: 0, conflicts: 0, quarantined: 2, blocked: 3, headerChanged: false });
  assert.deepEqual([...store.records.keys()].sort(), [id(1), id(3)]);
  assert.equal(store.records.get(id(3))?.dirty, true);
  assert.deepEqual(await store.getQuarantine(), [{ id: id(3), rev: 3 }, { id: id(4), rev: 4 }]);
});

test('quarantinedRecordIsNeverUploadedOverLater', async () => {
  const s = server();
  const store = await device();
  await store.commit({ records: [{ id: id(1), sealed: await seal(1) }] });
  s.put(id(1), randomBytes(60));
  assert.deepEqual(await sync(store, s.t), { pulled: 0, pushed: 0, conflicts: 0, quarantined: 1, blocked: 1, headerChanged: false });
  const again = await sync(store, s.t);
  assert.deepEqual([again.pushed, again.blocked], [0, 1]);
  assert.equal(s.calls.some((c) => c.startsWith('push')), false);
  assert.equal(store.records.get(id(1))?.dirty, true);
});

test('differentHeaderIsReportedNotWritten', async () => {
  const s = server();
  s.setHeader(headerToJson({ ...HEADER, salt: new Uint8Array(16).fill(7) }));
  const store = await device();
  assert.equal((await sync(store, s.t)).headerChanged, true);
  assert.equal(store.header, HEADER);
});

test('oversizeLocalRecordIsSkippedAndReported', async () => {
  const s = server();
  const strict: Transport = {
    ...s.t,
    push: async (token, req) => {
      if (req.upserts.some((u) => u.ciphertext.length > 90_000)) throw new SyncHttpError(413);
      return s.t.push(token, req);
    },
  };
  const store = await device();
  const huge = await seal(2, { type: 'note', name: 'huge', text: 'x'.repeat(70_000), updatedAt: T });
  await store.commit({ records: [{ id: id(1), sealed: await seal(1) }, { id: id(2), sealed: huge }] });
  const report = await sync(store, strict);
  assert.deepEqual([report.pushed, report.blocked], [1, 1]);
  assert.deepEqual([...s.rows.keys()], [id(1)]);
  assert.deepEqual(store.records.get(id(2)), { sealed: huge, rev: 0, dirty: true });
  assert.equal((await sync(store, strict)).blocked, 1);
});
