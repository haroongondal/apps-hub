import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ADD_TODO, assertRowShape, auditManifest, defineShare } from '@apps-hub/app-link-contract';
import { AUTHORITY } from '../index.ts';
import { INFLOW_BRIEFING_SHARE, INFLOW_HEALTH_SHARE } from '../inflow-shares.ts';

const root = (rel: string) => new URL(`../../../../${rel}`, import.meta.url);
const read = (rel: string) => fs.readFileSync(root(rel), 'utf8');
const json = (rel: string) => JSON.parse(read(rel));

test('the health share equals the app-health fixture the Kotlin provider is tested against', () => {
  const { path, columns, maxRows } = INFLOW_HEALTH_SHARE;
  assert.deepEqual(json('packages/app-link-contract/fixtures/app-health.share.json'), { path, columns, maxRows });
});

test('the health share lives on the legacy authority', () => {
  assert.equal(INFLOW_HEALTH_SHARE.authority, 'com.haroon.inflow.autopilot');
  assert.equal(INFLOW_HEALTH_SHARE.authority, AUTHORITY);
  assert.equal(INFLOW_HEALTH_SHARE.uri(), 'content://com.haroon.inflow.autopilot/health');
});

test('the sample health rows pass the share shape, and the health row holds no personal data', () => {
  const rows: unknown[] = json('packages/app-link-contract/fixtures/app-health-rows.sample.json');
  assert.ok(rows.length > 0);
  for (const row of rows) assertRowShape(INFLOW_HEALTH_SHARE, row);
  assert.deepEqual([...INFLOW_HEALTH_SHARE.columns], ['app_id', 'accessibility', 'listener', 'ai_source', 'last_seen_at']);
});

test("Inflow's module manifest passes the link audit", () => {
  assert.deepEqual(auditManifest(read('apps/inflow/modules/inflow-core/android/src/main/AndroidManifest.xml')), []);
});

test('the module manifest declares the ADD_TODO activity behind the link permission, and nothing else listens for it', () => {
  const xml = read('apps/inflow/modules/inflow-core/android/src/main/AndroidManifest.xml');
  const activity = /<activity\s[^>]*AddTodoActivity[^>]*>/.exec(xml)?.[0] ?? '';
  assert.match(activity, /android:exported="true"/);
  assert.match(activity, /android:permission="com\.haroon\.permission\.AUTOPILOT"/);
  assert.equal(xml.split(ADD_TODO.name).length - 1, 1);
});

const briefingFixture = () => json('packages/autopilot-contract/fixtures/briefing.share.json');

test('the briefing share equals the fixture the Kotlin provider is tested against', () => {
  const { authority, path, columns, maxRows } = INFLOW_BRIEFING_SHARE;
  assert.deepEqual(briefingFixture(), { authority, path, columns, maxRows });
  assert.equal(INFLOW_BRIEFING_SHARE.uri(), 'content://com.haroon.inflow.autopilot/briefing');
  assert.deepEqual(INFLOW_BRIEFING_SHARE.types, { line_id: 'long', kind: 'string', text: 'string', at: 'long?', personal: 'int' });
});

test('the sample briefing rows pass the share shape: a personal medicine row, a row without a time, at most 20 rows of 60 characters', () => {
  const rows: Record<string, unknown>[] = json('packages/autopilot-contract/fixtures/briefing-rows.sample.json');
  for (const row of rows) assertRowShape(INFLOW_BRIEFING_SHARE, row);
  assert.ok(rows.length <= INFLOW_BRIEFING_SHARE.maxRows);
  assert.ok(rows.some((r) => r.kind === 'medicine' && r.personal === 1));
  assert.ok(rows.some((r) => r.at === null));
  assert.ok(rows.every((r) => (r.text as string).length <= 60 && (r.personal === 0 || r.personal === 1)));
});

test('a briefing row with an extra column, a missing one or a wrong type fails, and no column can be called private', () => {
  const ok = { line_id: 1, kind: 'bill', text: 'Bill due 25 Nov', at: null, personal: 0 };
  assertRowShape(INFLOW_BRIEFING_SHARE, ok);
  assert.throws(() => assertRowShape(INFLOW_BRIEFING_SHARE, { ...ok, private: 1 }), /extra \[private\]/);
  assert.throws(() => assertRowShape(INFLOW_BRIEFING_SHARE, { ...ok, sensitive: 1 }), /extra/);
  const { text: _text, ...noText } = ok;
  assert.throws(() => assertRowShape(INFLOW_BRIEFING_SHARE, noText), /missing \[text\]/);
  assert.throws(() => assertRowShape(INFLOW_BRIEFING_SHARE, { ...ok, personal: 'yes' }), /personal must be int/);
  assert.throws(() => assertRowShape(INFLOW_BRIEFING_SHARE, { ...ok, at: undefined }), /at must be long\?/);
  assert.throws(
    () => defineShare<{ line_id: number; private: number }>()({ authority: 'com.haroon.inflow.autopilot', path: 'briefing', columns: { line_id: 'long', private: 'int' }, description: 'x' }),
    /looks sensitive/,
  );
});
