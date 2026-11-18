import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanDesignName, MAX_SAVED, removeSaved, renameSaved, upsertSaved, type SavedDesign } from '../editor/saved-list.ts';

const row = (n: number, extra: Partial<SavedDesign> = {}): SavedDesign => ({ id: `m${n}`, name: `D${n}`, path: `Documents/Design Editor/D${n}.json`, added: n, ...extra });
const rows = (count: number) => Array.from({ length: count }, (_, i) => row(i));

test('upsertSaved: a new design goes first with its own id and the time', () => {
  const { next, entry, dropped } = upsertSaved([row(1)], { id: 'fresh', name: 'Poster', path: 'Documents/Design Editor/Poster.json' }, 99);
  assert.deepEqual(next.map(d => d.id), ['fresh', 'm1']);
  assert.deepEqual([entry.added, dropped.length], [99, 0]);
});

test('upsertSaved: a re-save keeps the row id and date, moves it first, and does not duplicate it', () => {
  const { next, entry } = upsertSaved([row(1), row(2), row(3)], { id: 'ignored', name: 'D2', path: row(2).path }, 99);
  assert.deepEqual(next.map(d => d.id), ['m2', 'm1', 'm3']);
  assert.deepEqual([entry.id, entry.added], ['m2', 2]);
});

test('upsertSaved: a re-save keeps a name the person chose, and follows the file name otherwise', () => {
  const chosen = upsertSaved([row(1, { name: 'My poster', renamed: true })], { id: 'x', name: 'D1', path: row(1).path }, 9);
  assert.deepEqual([chosen.entry.name, chosen.entry.renamed], ['My poster', true]);
  const followed = upsertSaved([row(1)], { id: 'x', name: 'Renamed outside', path: row(1).path }, 9);
  assert.deepEqual([followed.entry.name, followed.entry.renamed], ['Renamed outside', undefined]);
});

test('upsertSaved: rows pushed past the cap are returned so their mirror files can go', () => {
  const { next, dropped } = upsertSaved(rows(MAX_SAVED), { id: 'new', name: 'N', path: 'Documents/Design Editor/N.json' }, 99);
  assert.equal(next.length, MAX_SAVED);
  assert.equal(next[0].id, 'new');
  assert.deepEqual(dropped.map(d => d.id), [`m${MAX_SAVED - 1}`]);
  assert.deepEqual(upsertSaved(rows(MAX_SAVED), { id: 'x', name: 'D3', path: row(3).path }, 1).dropped, []);
});

test('removeSaved: takes out one row and keeps the order of the rest', () => {
  assert.deepEqual(removeSaved(rows(3), 'm1').map(d => d.id), ['m0', 'm2']);
  assert.deepEqual(removeSaved(rows(2), 'nope').map(d => d.id), ['m0', 'm1']);
});

test('cleanDesignName: tidies spaces, slashes and a .json ending; empty is refused', () => {
  assert.equal(cleanDesignName('  Summer   sale '), 'Summer sale');
  assert.equal(cleanDesignName('a/b\\c.JSON'), 'a b c');
  assert.equal(cleanDesignName('x'.repeat(200))?.length, 80);
  assert.equal(cleanDesignName('   '), null);
  assert.equal(cleanDesignName('.json'), null);
});

test('renameSaved: renames one row, marks it as chosen, and leaves its path and date', () => {
  const next = renameSaved(rows(2), 'm1', ' New name ')!;
  assert.deepEqual(next[1], { ...row(1), name: 'New name', renamed: true });
  assert.deepEqual(next[0], row(0));
  assert.equal(renameSaved(rows(2), 'nope', 'x'), null);
  assert.equal(renameSaved(rows(2), 'm0', '  '), null);
});
