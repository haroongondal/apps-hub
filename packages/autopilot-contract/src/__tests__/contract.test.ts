import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assertRowShape, LINK_PERMISSION } from '@apps-hub/app-link-contract';
import { AUTHORITY, KINDS, NEVER_SHARE, NEVER_SHARE_DATA, PERMISSION, ROW_KEYS, STATES, SUGGESTIONS_SHARE } from '../index.ts';
import type { SuggestionRow } from '../index.ts';

const read = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

test('constants match the spec', () => {
  assert.equal(AUTHORITY, 'com.haroon.inflow.autopilot');
  assert.equal(PERMISSION, 'com.haroon.permission.AUTOPILOT');
  assert.equal(PERMISSION, LINK_PERMISSION);
});

test('suggestions share: columns equal ROW_KEYS in order, URIs follow the spec', () => {
  assert.deepEqual(ROW_KEYS, ['id', 'kind', 'title', 'item_id', 'due_at', 'state', 'created_at', 'expires_at']);
  assert.deepEqual(SUGGESTIONS_SHARE.columns, ROW_KEYS);
  assert.equal(SUGGESTIONS_SHARE.authority, AUTHORITY);
  assert.equal(SUGGESTIONS_SHARE.uri(3), 'content://com.haroon.inflow.autopilot/suggestions/3');
  assert.equal(SUGGESTIONS_SHARE.uri(), 'content://com.haroon.inflow.autopilot/suggestions');
});

test('sample rows: one per kind, exact keys, valid states', () => {
  const rows: SuggestionRow[] = read('suggestion-rows.sample.json');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['bill', 'event', 'money', 'reply']);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
    assert.ok(STATES.includes(row.state));
    assertRowShape(SUGGESTIONS_SHARE, row);
  }
});

test('never-share list covers Strongroom and Inflow', () => {
  assert.deepEqual(NEVER_SHARE, read('never-share.json'));
  assert.ok(NEVER_SHARE.includes('com.haroon.strongroom'));
  assert.ok(NEVER_SHARE.includes('com.haroon.inflow'));
});

test('never-share data names every health kind, and no suggestion column or kind carries one', () => {
  assert.deepEqual(NEVER_SHARE_DATA, read('never-share-data.json'));
  for (const kind of ['health', 'journal', 'medicine', 'steps', 'sleep', 'heart']) assert.ok(NEVER_SHARE_DATA.includes(kind), kind);
  for (const name of [...SUGGESTIONS_SHARE.columns, ...KINDS]) {
    for (const data of NEVER_SHARE_DATA) assert.ok(!name.toLowerCase().includes(data), `${name} names ${data}`);
  }
});
