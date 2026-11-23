import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertRowShape, isSensitiveName, parseAiSource } from '@apps-hub/app-link-contract';

import { HEALTH_SHARE, TODAY_SHARE, todayFixture } from '../provided.ts';

const fixtures = path.join(import.meta.dirname, '../../fixtures');
const contractFixtures = path.join(import.meta.dirname, '../../../../../../packages/app-link-contract/fixtures');
const read = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('the Kotlin fixture equals the TODAY_SHARE the app declares', () => {
  assert.deepEqual(read(fixtures, 'today.share.json'), todayFixture());
});

test('today and health sit on the pdf-editor authority, one path each', () => {
  assert.equal(TODAY_SHARE.authority, 'com.haroon.pdfeditor.applink');
  assert.equal(HEALTH_SHARE.authority, TODAY_SHARE.authority);
  assert.equal(TODAY_SHARE.path, 'today');
  assert.equal(HEALTH_SHARE.path, 'health');
  assert.equal(TODAY_SHARE.maxRows, 100);
  assert.equal(TODAY_SHARE.uri(), 'content://com.haroon.pdfeditor.applink/today');
});

test('no column is named like a secret', () => {
  for (const c of [...TODAY_SHARE.columns, ...HEALTH_SHARE.columns]) assert.equal(isSensitiveName(c), false, c);
});

test('sample today rows have the declared shape and wrong ones are refused', () => {
  const rows: Record<string, unknown>[] = read(fixtures, 'today-rows.sample.json');
  assert.ok(rows.length >= 2);
  for (const row of rows) assertRowShape(TODAY_SHARE, row);
  assert.throws(() => assertRowShape(TODAY_SHARE, { id: 1, title: 5, due_at: 1 }));
  assert.throws(() => assertRowShape(TODAY_SHARE, { id: 1, title: 'x', due_at: 'soon' }));
  assert.throws(() => assertRowShape(TODAY_SHARE, { id: 1, title: 'x', due_at: 1, extra: 1 }));
});

test("the contract's health sample rows fit Nexus's health share and the contract's fixture", () => {
  for (const row of read(contractFixtures, 'app-health-rows.sample.json') as Record<string, unknown>[]) {
    assertRowShape(HEALTH_SHARE, row);
    assert.equal(parseAiSource(row.ai_source), row.ai_source);
  }
  const { path: p, columns, maxRows } = HEALTH_SHARE;
  assert.deepEqual(read(contractFixtures, 'app-health.share.json'), { path: p, columns: [...columns], maxRows });
});
