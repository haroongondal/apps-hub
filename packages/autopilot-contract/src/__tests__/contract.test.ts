import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { AUTHORITY, NEVER_SHARE, PERMISSION, ROW_KEYS, STATES } from '../index.ts';
import type { SuggestionRow } from '../index.ts';

const read = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

test('constants match the spec', () => {
  assert.equal(AUTHORITY, 'com.haroon.inflow.autopilot');
  assert.equal(PERMISSION, 'com.haroon.permission.AUTOPILOT');
});

test('sample rows: one per kind, exact keys, valid states', () => {
  const rows: SuggestionRow[] = read('suggestion-rows.sample.json');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['bill', 'event', 'money', 'reply']);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
    assert.ok(STATES.includes(row.state));
  }
});

test('never-share list covers Strongroom and Inflow', () => {
  assert.deepEqual(NEVER_SHARE, read('never-share.json'));
  assert.ok(NEVER_SHARE.includes('com.haroon.strongroom'));
  assert.ok(NEVER_SHARE.includes('com.haroon.inflow'));
});
