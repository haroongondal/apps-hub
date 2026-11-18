import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileNameOf, newPage, newSession, restoreSession, withoutPage } from '../scan/session-data.ts';

const quad = [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] as const;

test('a saved session comes back as written', () => {
  const s = { ...newSession('f1', 5), pages: [newPage('cap-2.jpg', [...quad]), newPage('cap-1.jpg', null)] };
  const back = restoreSession(JSON.stringify(s), ['session.json', 'cap-1.jpg', 'cap-2.jpg'], 9);
  assert.deepEqual(back, s);
});

test('pages whose file is gone are dropped; captures missing from the JSON are added in capture order', () => {
  const s = { ...newSession(null, 5), pages: [newPage('cap-5.jpg', null), newPage('cap-9.jpg', null)] };
  const back = restoreSession(JSON.stringify(s), ['cap-5.jpg', 'cap-30.jpg', 'cap-12.jpg', 'cap-12.jpg.tmp', 'session.json'], 9);
  assert.deepEqual(back?.pages.map((p) => p.file), ['cap-5.jpg', 'cap-12.jpg', 'cap-30.jpg']);
});

test('unreadable JSON rebuilds from the captures; nothing at all is no session', () => {
  const back = restoreSession('{"version":1,"pag', ['cap-3.jpg', 'cap-1.jpg'], 7);
  assert.equal(back?.startedAt, 7);
  assert.equal(back?.folderId, null);
  assert.deepEqual(back?.pages.map((p) => p.file), ['cap-1.jpg', 'cap-3.jpg']);
  assert.equal(restoreSession(null, [], 7), null);
  assert.equal(restoreSession('{"version":2,"pages":[]}', [], 7), null);
});

test('an empty saved session stays a session with no pages', () => {
  assert.deepEqual(restoreSession(JSON.stringify(newSession('f', 1)), ['session.json'], 2)?.pages, []);
});

test('fileNameOf takes the last path segment of a file URI', () => {
  assert.equal(fileNameOf('file:///data/user/0/x/files/scan-session/cap-17.jpg'), 'cap-17.jpg');
});

test('withoutPage drops only the page with that file and keeps the order of the rest', () => {
  const s = { ...newSession('f', 1), pages: [newPage('cap-1.jpg', null), newPage('cap-2.jpg', null), newPage('cap-3.jpg', null)] };
  const next = withoutPage(s, 'cap-2.jpg');
  assert.deepEqual(next.pages.map((p) => p.file), ['cap-1.jpg', 'cap-3.jpg']);
  assert.equal(next.folderId, 'f');
  assert.equal(s.pages.length, 3);
});

test('withoutPage on a file that is not a page changes nothing', () => {
  const s = { ...newSession(null, 1), pages: [newPage('cap-1.jpg', null)] };
  assert.equal(withoutPage(s, 'cap-9.jpg'), s);
});
