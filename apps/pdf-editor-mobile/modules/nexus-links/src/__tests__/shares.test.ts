import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertRowShape, isSensitiveName } from '@apps-hub/app-link-contract';

import { ASK_IDS_SHARE, ASK_ITEMS_SHARE, DEBITS_SHARE, PINNED_SHARE, READERS, readerFixture, RUNS_SHARE } from '../shares.ts';

const FIXTURE = path.join(import.meta.dirname, '../../fixtures/reader-shares.json');

test('the Kotlin fixture equals the TypeScript shares', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), readerFixture());
});

test('the reader allowlist is exactly the five shares, and only Inflow pages', () => {
  assert.deepEqual(Object.keys(READERS), ['inflow.ask_items', 'inflow.ask_ids', 'inflow.debits', 'deputy.runs', 'clipboard.pinned']);
  assert.deepEqual(Object.values(READERS).filter((r) => r.paged).map((r) => r.share.authority), Array(3).fill('com.haroon.inflow.autopilot'));
});

test('no column is named like a secret, text and account included', () => {
  for (const { share } of Object.values(READERS)) for (const c of share.columns) assert.equal(isSensitiveName(c), false, c);
});

test('sample rows have the declared shape', () => {
  assertRowShape(ASK_ITEMS_SHARE, { id: 4, app: 'sms', sender: null, text: 'Dinner at 8?', at: 1764000000000 });
  assertRowShape(ASK_IDS_SHARE, { id: 4 });
  assertRowShape(DEBITS_SHARE, { id: 9, amount_minor: 125000, at: 1764000000000, merchant: 'Daraz', account: 'Meezan card' });
  assertRowShape(RUNS_SHARE, { id: 2864434397, task: 'Tell me my next alarm', state: 'done', finished_at: 1764000000000 });
  assertRowShape(PINNED_SHARE, { id: 3, text: 'Flat 4B', pinned_at: 1764000000000, from_app: '' });
  assert.throws(() => assertRowShape(ASK_ITEMS_SHARE, { id: 4, app: 'sms', sender: null, text: 7, at: 1 }));
});

test('the paged URI carries a number only', () => {
  assert.equal(ASK_ITEMS_SHARE.uri(12), 'content://com.haroon.inflow.autopilot/ask_items/12');
  assert.throws(() => ASK_ITEMS_SHARE.uri(-1));
});
