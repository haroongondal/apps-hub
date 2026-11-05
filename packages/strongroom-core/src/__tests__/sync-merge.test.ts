import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Entry } from '../entry.ts';
import { planMerge } from '../sync/merge.ts';
import type { MergeLocal, MergeRemote } from '../sync/merge.ts';

const T = 1_800_000_000_000;
const DAY = 86_400_000;
const bytes = (n: number) => new Uint8Array(32).fill(n);
const login = (name: string, updatedAt: number): Entry => ({ type: 'login', name, username: 'me', password: 'pw', sites: [], apps: [], note: '', updatedAt });
const tombstone = (updatedAt: number): Entry => ({ type: 'deleted', updatedAt });
const local = (id: string, o: Partial<MergeLocal> = {}): MergeLocal => ({ id, rev: 3, dirty: true, sealed: bytes(1), entry: login('mine', T), ...o });
const remote = (id: string, o: Partial<MergeRemote> = {}): MergeRemote => ({ id, rev: 9, sealed: bytes(2), entry: login('theirs', T), ...o });
const EMPTY = { adopt: [], push: [], quarantine: [], blocked: [], conflicts: 0 };

test('remoteOnlyIsAdopted', () => {
  const r = remote('a');
  assert.deepEqual(planMerge([], [r]), { ...EMPTY, adopt: [r] });
});

test('localOnlyIsPushedWithBaseRevZero', () => {
  assert.deepEqual(planMerge([local('new', { rev: 0 })], []), { ...EMPTY, push: [{ id: 'new', baseRev: 0 }] });
  // A record synced before and edited since goes up on top of the rev it was based on.
  assert.deepEqual(planMerge([local('edited', { rev: 7 }), local('clean', { dirty: false })], []), { ...EMPTY, push: [{ id: 'edited', baseRev: 7 }] });
});

test('cleanLocalTakesRemote', () => {
  const r = remote('a', { entry: login('theirs', T) });
  assert.deepEqual(planMerge([local('a', { dirty: false, entry: login('mine', T + DAY) })], [r]), { ...EMPTY, adopt: [r] });
});

test('laterEditWins', () => {
  const older = remote('a', { entry: login('theirs', T) });
  assert.deepEqual(planMerge([local('a', { entry: login('mine', T + 5) })], [older]), { ...EMPTY, push: [{ id: 'a', baseRev: 9 }], conflicts: 1 });
  const newer = remote('a', { entry: login('theirs', T + 5) });
  assert.deepEqual(planMerge([local('a', { entry: login('mine', T) })], [newer]), { ...EMPTY, adopt: [newer], conflicts: 1 });
});

test('tombstoneWinsOnEqualTime', () => {
  const gone = remote('a', { entry: tombstone(T) });
  assert.deepEqual(planMerge([local('a', { entry: login('mine', T) })], [gone]), { ...EMPTY, adopt: [gone], conflicts: 1 });
  assert.deepEqual(planMerge([local('a', { entry: tombstone(T) })], [remote('a', { entry: login('theirs', T) })]), {
    ...EMPTY,
    push: [{ id: 'a', baseRev: 9 }],
    conflicts: 1,
  });
  const same = remote('a', { entry: login('theirs', T) });
  assert.deepEqual(planMerge([local('a', { entry: login('mine', T) })], [same]), { ...EMPTY, adopt: [same], conflicts: 1 });
});

test('editNewerThanTombstoneWins', () => {
  assert.deepEqual(planMerge([local('a', { entry: login('mine', T + 1) })], [remote('a', { entry: tombstone(T) })]), {
    ...EMPTY,
    push: [{ id: 'a', baseRev: 9 }],
    conflicts: 1,
  });
  const edit = remote('a', { entry: login('theirs', T + 1) });
  assert.deepEqual(planMerge([local('a', { entry: tombstone(T) })], [edit]), { ...EMPTY, adopt: [edit], conflicts: 1 });
});

test('undecryptableRemoteIsQuarantinedAndBlocked', () => {
  const bad = remote('a', { entry: null });
  assert.deepEqual(planMerge([], [bad]), { ...EMPTY, quarantine: [bad], blocked: ['a'] });
});

test('readableLocalBeatsUndecryptableRemote', () => {
  const bad = remote('a', { entry: null });
  assert.deepEqual(planMerge([local('a')], [bad]), { ...EMPTY, quarantine: [bad], blocked: ['a'] });
  assert.deepEqual(planMerge([local('a', { dirty: false })], [bad]), { ...EMPTY, quarantine: [bad], blocked: ['a'] });
  // The other way round: a readable remote replaces a local copy that does not open, and that copy is never pushed.
  const good = remote('b');
  assert.deepEqual(planMerge([local('b', { entry: null })], [good]), { ...EMPTY, adopt: [good] });
  assert.deepEqual(planMerge([local('c', { entry: null })], []), { ...EMPTY, blocked: ['c'] });
});

test('neverDeletesAnything', () => {
  const locals = [local('a', { dirty: false }), local('b'), local('c', { entry: tombstone(T + 1) }), local('d', { entry: null })];
  const remotes = [remote('b', { entry: tombstone(T + DAY) }), remote('e', { entry: null }), remote('f', { entry: tombstone(T) })];
  const plan = planMerge(locals, remotes);
  assert.deepEqual(Object.keys(plan).sort(), ['adopt', 'blocked', 'conflicts', 'push', 'quarantine']);
  for (const r of plan.adopt) assert.ok(remotes.includes(r));
  const touched = new Set([...plan.adopt.map((r) => r.id), ...plan.push.map((p) => p.id), ...plan.blocked]);
  assert.deepEqual([...touched].sort(), ['b', 'c', 'd', 'e', 'f']);
});

test('interruptedPushIsNotAConflict', () => {
  const back = remote('a', { sealed: bytes(1), rev: 12 });
  assert.deepEqual(planMerge([local('a', { sealed: bytes(1), rev: 3 })], [back]), { ...EMPTY, adopt: [back] });
  // Our own push coming back at the rev this newer edit is already based on: the remote did not change, so the edit just goes up.
  assert.deepEqual(planMerge([local('a', { sealed: bytes(3), rev: 12 })], [back]), { ...EMPTY, push: [{ id: 'a', baseRev: 12 }] });
});

test('skewedClockIsDeterministicAndCounted', () => {
  const ahead = remote('a', { entry: login('theirs', T + DAY) });
  const mine = local('a', { entry: login('mine', T) });
  const first = planMerge([mine], [ahead]);
  assert.deepEqual(first, { ...EMPTY, adopt: [ahead], conflicts: 1 });
  assert.deepEqual(planMerge([mine], [ahead]), first);
});
