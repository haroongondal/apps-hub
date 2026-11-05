import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBase64 } from 'strongroom-core';
import type { Header } from 'strongroom-core';
import { localStore } from '../storage.ts';
import { fakeChrome, useChrome } from './sync-world.ts';

const bytes = (n: number) => new Uint8Array(8).fill(n);
const header = (n: number): Header => ({ version: 1, kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1 }, salt: new Uint8Array(16).fill(n), passwordWrap: bytes(n), recoveryWrap: bytes(n) });
const fresh = () => {
  const f = fakeChrome();
  useChrome(f);
  return f;
};
const row = async (id: string) => (await localStore.getSyncRecords()).find((r) => r.id === id);
const empty = { records: [], quarantine: [], rebase: [] };

test('commit marks records dirty, keeps a known rev and starts a new id at rev 0', async () => {
  fresh();
  await localStore.commit({ records: [{ id: 'a', sealed: bytes(1) }] });
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(1), rev: 0, dirty: true });
  await localStore.applyPull({ ...empty, headerRev: 1, lastRev: 5, records: [{ id: 'a', sealed: bytes(1), rev: 5, seen: bytes(1) }] });
  await localStore.commit({ records: [{ id: 'a', sealed: bytes(2) }] });
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(2), rev: 5, dirty: true });
});

test('two saves made at once both land', async () => {
  fresh();
  await Promise.all([localStore.commit({ records: [{ id: 'a', sealed: bytes(1) }] }), localStore.commit({ records: [{ id: 'b', sealed: bytes(2) }] })]);
  assert.deepEqual((await localStore.getRecords()).map((r) => r.id).sort(), ['a', 'b']);
});

test('records saved before sync existed are read as dirty at rev 0', async () => {
  const f = fresh();
  f.data.set('records', { old: toBase64(bytes(7)) });
  assert.deepEqual(await row('old'), { id: 'old', sealed: bytes(7), rev: 0, dirty: true });
  assert.deepEqual(await localStore.getRecords(), [{ id: 'old', sealed: bytes(7) }]);
  await localStore.commit({ records: [{ id: 'new', sealed: bytes(8) }] });
  assert.deepEqual((await localStore.getSyncRecords()).map((r) => [r.id, r.rev, r.dirty]), [['old', 0, true], ['new', 0, true]]);
});

test('applyPull writes clean rows, the header and the meta in one storage write', async () => {
  const f = fresh();
  await localStore.applyPull({ ...empty, header: header(1), headerRev: 3, lastRev: 9, records: [{ id: 'a', sealed: bytes(1), rev: 9 }] });
  assert.deepEqual(f.setCalls.length, 1);
  assert.deepEqual(await localStore.getSyncMeta(), { lastRev: 9, headerRev: 3 });
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(1), rev: 9, dirty: false });
  assert.deepEqual(await localStore.getHeader(), header(1));
});

test('applyPullKeepsAnEditMadeDuringTheSync', async () => {
  fresh();
  const theirs = bytes(2);
  await localStore.applyPull({ ...empty, headerRev: 1, lastRev: 1, records: [{ id: 'a', sealed: bytes(1), rev: 1 }] });
  // The edit is queued ahead of the pull's write, as when a save lands while syncOnce is on the network.
  const edit = localStore.commit({ records: [{ id: 'a', sealed: bytes(9) }] });
  const pull = localStore.applyPull({ ...empty, headerRev: 1, lastRev: 5, records: [{ id: 'a', sealed: theirs, rev: 2, seen: bytes(1) }, { id: 'b', sealed: bytes(3), rev: 5 }] });
  await Promise.all([edit, pull]);
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(9), rev: 1, dirty: true });
  assert.deepEqual(await row('b'), { id: 'b', sealed: bytes(3), rev: 5, dirty: false });
  assert.deepEqual(await localStore.getSyncMeta(), { lastRev: 1, headerRev: 1 });
});

test('applyPull adopts a row that is still what the merge saw, and one that was absent', async () => {
  fresh();
  await localStore.commit({ records: [{ id: 'a', sealed: bytes(1) }] });
  await localStore.applyPull({ ...empty, headerRev: 1, lastRev: 4, records: [{ id: 'a', sealed: bytes(2), rev: 3, seen: bytes(1) }, { id: 'b', sealed: bytes(3), rev: 4 }] });
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(2), rev: 3, dirty: false });
  assert.deepEqual(await row('b'), { id: 'b', sealed: bytes(3), rev: 4, dirty: false });
  assert.equal((await localStore.getSyncMeta()).lastRev, 4);
});

test('applyPull holds back a row that appeared since the merge saw none', async () => {
  fresh();
  await localStore.commit({ records: [{ id: 'a', sealed: bytes(1) }] });
  await localStore.applyPull({ ...empty, headerRev: 1, lastRev: 4, records: [{ id: 'a', sealed: bytes(2), rev: 3 }] });
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(1), rev: 0, dirty: true });
  assert.equal((await localStore.getSyncMeta()).lastRev, 0);
});

test('a rebase sets the rev of an existing row only, and quarantine keeps one row per id and rev', async () => {
  fresh();
  await localStore.commit({ records: [{ id: 'a', sealed: bytes(1) }] });
  const p = { ...empty, headerRev: 1, lastRev: 7, quarantine: [{ id: 'q', sealed: bytes(5), rev: 6 }], rebase: [{ id: 'a', rev: 7 }, { id: 'nope', rev: 7 }] };
  await localStore.applyPull(p);
  await localStore.applyPull(p);
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(1), rev: 7, dirty: true });
  assert.equal(await row('nope'), undefined);
  assert.deepEqual(await localStore.getQuarantine(), [{ id: 'q', rev: 6 }]);
});

test('markPushed sets the rev and clears dirty only where the bytes are still the pushed ones', async () => {
  fresh();
  await localStore.commit({ records: [{ id: 'a', sealed: bytes(1) }, { id: 'b', sealed: bytes(2) }] });
  await localStore.commit({ records: [{ id: 'b', sealed: bytes(3) }] });
  await localStore.markPushed([{ id: 'a', sealed: bytes(1), rev: 4 }, { id: 'b', sealed: bytes(2), rev: 5 }]);
  assert.deepEqual(await row('a'), { id: 'a', sealed: bytes(1), rev: 4, dirty: false });
  assert.deepEqual(await row('b'), { id: 'b', sealed: bytes(3), rev: 5, dirty: true });
});

test('everything sync keeps beside the records is read back, with defaults for a vault that never synced', async () => {
  fresh();
  assert.deepEqual(await localStore.getSyncLocal(), { accountKey: null, info: { lastSyncAt: null, blocked: 0, needsSignIn: false }, pending: null });
  assert.deepEqual(await localStore.getSyncMeta(), { lastRev: 0, headerRev: 0 });
});
