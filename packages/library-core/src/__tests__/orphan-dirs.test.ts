import test from 'node:test';
import assert from 'node:assert/strict';

import { ITEM_ID, orphanDirs } from '../orphan-dirs.ts';

test('ITEM_ID is 16 base-36 characters', () => {
  assert.ok(ITEM_ID.test('0123456789abcdef'));
  assert.ok(!ITEM_ID.test('0123456789abcde')); // 15
  assert.ok(!ITEM_ID.test('0123456789abcdefg')); // 17
  assert.ok(!ITEM_ID.test('0123456789ABCDEF')); // upper case
  assert.ok(!ITEM_ID.test('0123456789abcd-f'));
});

test('only id-shaped names without a row are orphans', () => {
  const rows = new Set(['aaaaaaaaaaaaaaaa']);
  const names = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'scan-session', '.DS_Store', 'tmp', 'cccccccccccccccc'];
  assert.deepEqual(orphanDirs(names, rows), ['bbbbbbbbbbbbbbbb', 'cccccccccccccccc']);
});

test('nothing to sweep when every directory has a row', () => {
  assert.deepEqual(orphanDirs(['aaaaaaaaaaaaaaaa'], new Set(['aaaaaaaaaaaaaaaa'])), []);
  assert.deepEqual(orphanDirs([], new Set()), []);
});
