import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { AI_SOURCES, HEALTH_AUTHORITIES, appHealthShare, assertRowShape, isKnownAuthority, isSensitiveName, parseAiSource } from '../index.ts';
import type { HealthAppId } from '../index.ts';

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const ids = Object.keys(HEALTH_AUTHORITIES) as HealthAppId[];

test('one health share per app id, at its authority, path health, one row', () => {
  for (const app of ids) {
    const share = appHealthShare(app);
    assert.equal(share.authority, HEALTH_AUTHORITIES[app]);
    assert.equal(share.path, 'health');
    assert.equal(share.maxRows, 1);
    assert.equal(share.uri(), `content://${HEALTH_AUTHORITIES[app]}/health`);
  }
});

test('dashed release ids map to one-word authorities; inflow keeps its legacy one', () => {
  assert.equal(appHealthShare('pdf-editor').authority, 'com.haroon.pdfeditor.applink');
  assert.equal(appHealthShare('open-tunnel').authority, 'com.haroon.opentunnel.applink');
  assert.equal(appHealthShare('design-editor').authority, 'com.haroon.designeditor.applink');
  assert.equal(appHealthShare('ai-hub').authority, 'com.haroon.aihub.applink');
  assert.equal(appHealthShare('netlens').authority, 'com.haroon.netlens.applink');
  assert.equal(appHealthShare('inflow').authority, 'com.haroon.inflow.autopilot');
  for (const a of Object.values(HEALTH_AUTHORITIES)) assert.ok(isKnownAuthority(a), a);
  assert.equal(new Set(Object.values(HEALTH_AUTHORITIES)).size, ids.length);
});

test('refuses an app with no health authority', () => {
  for (const app of ['store', 'notch', 'nexus', '', 'toString', '__proto__']) {
    assert.throws(() => appHealthShare(app as HealthAppId), /no health authority/, app);
  }
});

test('column names carry nothing sensitive, and ai_source is not called key', () => {
  const share = appHealthShare('deputy');
  assert.deepEqual(share.columns, ['app_id', 'accessibility', 'listener', 'ai_source', 'last_seen_at']);
  for (const c of share.columns) assert.equal(isSensitiveName(c), false, c);
  assert.equal(isSensitiveName('ai_key'), true);
  assert.equal(isSensitiveName('ai_key_source'), true);
});

test('the share equals fixtures/app-health.share.json (each app binds its provider to it)', () => {
  const { path, columns, maxRows } = appHealthShare('halo');
  assert.deepEqual(fixture('app-health.share.json'), { path, columns: [...columns], maxRows });
});

test('sample rows fit the share and use only the allowed values', () => {
  const rows: Record<string, unknown>[] = fixture('app-health-rows.sample.json');
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    const share = appHealthShare(row.app_id as HealthAppId);
    assertRowShape(share, row);
    for (const flag of [row.accessibility, row.listener]) assert.ok(flag === null || flag === 0 || flag === 1, JSON.stringify(row));
    assert.equal(parseAiSource(row.ai_source), row.ai_source);
  }
  assert.deepEqual(new Set(rows.map((r) => r.ai_source)), new Set(AI_SOURCES));
});

test('parseAiSource accepts hub, own and none only', () => {
  for (const s of AI_SOURCES) assert.equal(parseAiSource(s), s);
  for (const bad of ['HUB', 'hub ', '', 'gemini', null, undefined, 1, {}]) assert.equal(parseAiSource(bad), null, String(bad));
});
