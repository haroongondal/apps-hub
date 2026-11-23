import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RawShare } from '@apps-hub/media-core';
import { inboxUri, listInbox, receiveShare, type IntakeDeps } from '../media/share-intake.ts';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const MP4 = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0];
const ROOT = 'file:///files/shared/';
const raw = (n: number, over: Partial<RawShare> = {}): RawShare => ({ uri: `${ROOT}1700/${n}.part`, name: `p${n}.jpg`, mime: 'image/jpeg', bytes: 10 + n, head: JPEG, ...over });

function fake(items: RawShare[], extra: { overCap?: number; blocked?: number; moveFails?: string } = {}) {
  const moved: [string, string][] = [];
  const removed: string[] = [];
  const deps: IntakeDeps = {
    take: async () => ({ items, overCap: extra.overCap ?? 0, blocked: extra.blocked ?? 0 }),
    move: async (from, to) => { if (extra.moveFails && to.includes(extra.moveFails)) throw new Error('x'); moved.push([from, to]); },
    remove: async uri => { removed.push(uri); },
  };
  return { deps, moved, removed };
}

test('what is shared is renamed to a safe name in the same folder, and nothing else happens', async () => {
  const f = fake([raw(1, { name: '../../evil#1%.jpg' })]);
  const got = await receiveShare(f.deps);
  assert.deepEqual(got.notes, []);
  assert.deepEqual(got.items.map(i => i.uri), [`${ROOT}1700/evil%231%25.jpg`]);
  assert.deepEqual(f.moved, [[`${ROOT}1700/1.part`, `${ROOT}1700/evil%231%25.jpg`]]);
  assert.deepEqual(f.removed, []);
});

test('a file that is not a picture or video is deleted and explained; a failed copy has nothing to delete', async () => {
  const f = fake([
    raw(1, { name: 'doc.jpg', head: [0x25, 0x50, 0x44, 0x46] }),
    raw(2, { uri: '', problem: 'too_big', head: [], name: 'huge.mp4' }),
    raw(3, { name: 'ok.mp4', mime: 'video/mp4', head: MP4 }),
  ]);
  const got = await receiveShare(f.deps);
  assert.deepEqual(got.items.map(i => i.name), ['ok.mp4']);
  assert.deepEqual(f.removed, [`${ROOT}1700/1.part`]);
  assert.equal(got.notes.length, 2);
  assert.match(got.notes[1], /huge is too big/);
});

test('streams over the cap or sent as something other than a file are mentioned once', async () => {
  const got = await receiveShare(fake([raw(1)], { overCap: 3, blocked: 1 }).deps);
  assert.deepEqual(got.notes, ['Only the first 20 were added.', 'Some items could not be added because they were not sent as files.']);
});

test('a rename that fails removes the copy and says so', async () => {
  const f = fake([raw(1, { name: 'a.jpg' }), raw(2, { name: 'b.jpg' })], { moveFails: 'a.jpg' });
  const got = await receiveShare(f.deps);
  assert.deepEqual(got.items.map(i => i.name), ['b.jpg']);
  assert.deepEqual(f.removed, [`${ROOT}1700/1.part`]);
  assert.deepEqual(got.notes, ["a.jpg couldn't be saved. Share it again."]);
});

test('the inbox lists pictures and videos, newest share first, and skips everything else', async () => {
  const dirs: Record<string, string[]> = {
    [ROOT]: ['1700', '1800', 'notes'],
    [`${ROOT}1700/`]: ['b.mp4', '0.part'],
    [`${ROOT}1800/`]: ['z.jpg', 'readme.txt', 'a#b.png'],
  };
  const list = await listInbox({ root: ROOT, readDir: async u => dirs[u] ?? [], sizeOf: async u => (u.endsWith('z.jpg') ? 5 : 7) });
  assert.deepEqual(list.map(i => [i.name, i.kind, i.bytes]), [['a#b.png', 'image', 7], ['z.jpg', 'image', 5], ['b.mp4', 'video', 7]]);
  assert.equal(list[0].uri, inboxUri(`${ROOT}1800/`, 'a#b.png'));
  assert.ok(list[0].uri.endsWith('a%23b.png'));
});

test('an empty or missing inbox is an empty list', async () => {
  assert.deepEqual(await listInbox({ root: ROOT, readDir: async () => { throw new Error('none'); }, sizeOf: async () => 0 }), []);
});
