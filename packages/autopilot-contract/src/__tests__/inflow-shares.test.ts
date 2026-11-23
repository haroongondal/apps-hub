import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assertRowShape, auditManifest } from '@apps-hub/app-link-contract';
import { AUTHORITY } from '../index.ts';
import { INFLOW_HEALTH_SHARE } from '../inflow-shares.ts';

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
