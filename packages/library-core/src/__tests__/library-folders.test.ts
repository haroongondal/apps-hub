import test from 'node:test';
import assert from 'node:assert/strict';

import { LibraryError } from '../errors.ts';
import { names, openLibrary, titles } from './helpers.ts';

const code = (c: string) => (e: unknown) => e instanceof LibraryError && e.code === c;

test('createFolder trims the name and starts empty', async () => {
  const { lib } = await openLibrary();
  const f = await lib.createFolder('  Work  ', null);
  assert.equal(f.name, 'Work');
  assert.equal(f.parentId, null);
  assert.equal(f.itemCount, 0);
  assert.deepEqual(names(await lib.listFolders(null)), ['Work']);
});

test('folder names are validated', async () => {
  const { lib } = await openLibrary();
  for (const name of ['', '   ', 'a/b', '/', 'x'.repeat(101), 'bad\u0007name']) {
    await assert.rejects(lib.createFolder(name, null), code('invalid_name'), JSON.stringify(name));
  }
  await lib.createFolder('x'.repeat(100), null);
});

test('a name is unique within its parent, ignoring case', async () => {
  const { lib } = await openLibrary();
  const work = await lib.createFolder('Work', null);
  await assert.rejects(lib.createFolder('work', null), code('duplicate_name'));
  await assert.rejects(lib.createFolder('WORK', null), code('duplicate_name'));
  // The same name under another parent, or under the top level, is fine.
  await lib.createFolder('Taxes', work.id);
  await lib.createFolder('Taxes', null);
  await assert.rejects(lib.createFolder('taxes', work.id), code('duplicate_name'));
});

test('createFolder under a missing parent is not_found', async () => {
  const { lib } = await openLibrary();
  await assert.rejects(lib.createFolder('X', 'nope'), code('not_found'));
});

test('renameFolder allows a case-only change but not a sibling name', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createFolder('Alpha', null);
  await lib.createFolder('Beta', null);
  await lib.renameFolder(a.id, 'ALPHA');
  assert.deepEqual(names(await lib.listFolders(null)), ['ALPHA', 'Beta']);
  await assert.rejects(lib.renameFolder(a.id, 'beta'), code('duplicate_name'));
  await assert.rejects(lib.renameFolder(a.id, ''), code('invalid_name'));
  await assert.rejects(lib.renameFolder('nope', 'X'), code('not_found'));
});

test('moveFolder into itself or a descendant is a cycle', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createFolder('A', null);
  const b = await lib.createFolder('B', a.id);
  const c = await lib.createFolder('C', b.id);
  await assert.rejects(lib.moveFolder(a.id, a.id), code('cycle'));
  await assert.rejects(lib.moveFolder(a.id, b.id), code('cycle'));
  await assert.rejects(lib.moveFolder(a.id, c.id), code('cycle'));
  // Nothing moved.
  assert.deepEqual((await lib.folderPath(c.id)).map((f) => f.name), ['A', 'B', 'C']);
});

test('moveFolder to another parent or the top level', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createFolder('A', null);
  const b = await lib.createFolder('B', null);
  const c = await lib.createFolder('C', a.id);
  await lib.moveFolder(c.id, b.id);
  assert.deepEqual((await lib.folderPath(c.id)).map((f) => f.name), ['B', 'C']);
  await lib.moveFolder(c.id, null);
  assert.deepEqual((await lib.folderPath(c.id)).map((f) => f.name), ['C']);
  await assert.rejects(lib.moveFolder(c.id, 'nope'), code('not_found'));
  await assert.rejects(lib.moveFolder('nope', null), code('not_found'));
});

test('moveFolder refuses a name that already exists in the target', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createFolder('A', null);
  const inner = await lib.createFolder('Same', a.id);
  await lib.createFolder('same', null);
  await assert.rejects(lib.moveFolder(inner.id, null), code('duplicate_name'));
  assert.equal((await lib.folderPath(inner.id)).length, 2);
});

test('deleteFolder moves items and subfolders up one level and deletes no item (AC-2)', async () => {
  const { lib } = await openLibrary();
  const work = await lib.createFolder('Work', null);
  const sub = await lib.createFolder('Sub', work.id);
  const i1 = await lib.createItem({ kind: 'pdf', title: 'One', folderId: work.id });
  const i2 = await lib.createItem({ kind: 'scan', title: 'Two', folderId: work.id });
  await lib.createItem({ kind: 'pdf', title: 'Elsewhere' });
  const before = (await lib.list({ everywhere: true })).length;

  await lib.deleteFolder(work.id);

  assert.equal((await lib.list({ everywhere: true })).length, before);
  assert.deepEqual(titles(await lib.list({ folderId: null, sort: 'title' })), ['Elsewhere', 'One', 'Two']);
  assert.deepEqual(names(await lib.listFolders(null)), ['Sub']);
  assert.equal((await lib.listFolders(null))[0].id, sub.id);
  // Moving them is not editing them: updated_at is untouched.
  assert.equal((await lib.getItem(i1.id))!.updatedAt, i1.updatedAt);
  assert.equal((await lib.getItem(i2.id))!.updatedAt, i2.updatedAt);
});

test('deleteFolder inside another folder moves the content to that folder', async () => {
  const { lib } = await openLibrary();
  const outer = await lib.createFolder('Outer', null);
  const inner = await lib.createFolder('Inner', outer.id);
  const deeper = await lib.createFolder('Deeper', inner.id);
  const item = await lib.createItem({ kind: 'pdf', title: 'X', folderId: inner.id });
  await lib.deleteFolder(inner.id);
  assert.equal((await lib.getItem(item.id))!.folderId, outer.id);
  assert.deepEqual((await lib.folderPath(deeper.id)).map((f) => f.name), ['Outer', 'Deeper']);
});

test('deleteFolder with a clashing subfolder name changes nothing', async () => {
  const { lib } = await openLibrary();
  const work = await lib.createFolder('Work', null);
  await lib.createFolder('Taxes', work.id);
  await lib.createFolder('taxes', null);
  const item = await lib.createItem({ kind: 'pdf', title: 'X', folderId: work.id });
  await assert.rejects(lib.deleteFolder(work.id), code('duplicate_name'));
  assert.equal((await lib.getItem(item.id))!.folderId, work.id);
  assert.deepEqual(names(await lib.listFolders(null)), ['taxes', 'Work']);
  await assert.rejects(lib.deleteFolder('nope'), code('not_found'));
});

test('folderPath runs from the root to the folder', async () => {
  const { lib } = await openLibrary();
  const a = await lib.createFolder('A', null);
  const b = await lib.createFolder('B', a.id);
  assert.deepEqual((await lib.folderPath(a.id)).map((f) => f.name), ['A']);
  assert.deepEqual((await lib.folderPath(b.id)).map((f) => f.name), ['A', 'B']);
  await assert.rejects(lib.folderPath('nope'), code('not_found'));
});

test('listFolders orders by name and counts the items directly inside', async () => {
  const { lib } = await openLibrary();
  const b = await lib.createFolder('beta', null);
  const a = await lib.createFolder('Alpha', null);
  await lib.createFolder('nested', a.id);
  await lib.createItem({ kind: 'pdf', title: '1', folderId: a.id });
  await lib.createItem({ kind: 'pdf', title: '2', folderId: a.id });
  await lib.createItem({ kind: 'pdf', title: '3', folderId: b.id });
  const top = await lib.listFolders(null);
  assert.deepEqual(top.map((f) => [f.name, f.itemCount]), [['Alpha', 2], ['beta', 1]]);
  assert.deepEqual(names(await lib.listFolders(a.id)), ['nested']);
});
