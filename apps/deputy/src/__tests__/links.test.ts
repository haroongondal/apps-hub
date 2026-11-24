import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRowShape, auditManifest, isSensitiveName } from '@apps-hub/app-link-contract';
import { HEALTH_SHARE, RUNS_SHARE, WAITING_SHARE } from '../links.ts';

const MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../modules/deputy-agent/android/src');
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), 'utf8');
const fixture = (name: string): unknown => JSON.parse(read(`test/resources/applink/${name}`));
const RUN = 'expo.modules.deputyagent.android.RunSuggestionActivity';

test('waiting and runs equal the fixtures LinkRowsTest.kt binds the provider to', () => {
  for (const [share, file] of [[WAITING_SHARE, 'waiting.share.json'], [RUNS_SHARE, 'runs.share.json']] as const) {
    assert.deepEqual(fixture(file), { authority: share.authority, path: share.path, columns: share.columns, maxRows: share.maxRows });
  }
});

test('all three shares sit on the Deputy authority and no column is named like a secret', () => {
  for (const share of [HEALTH_SHARE, WAITING_SHARE, RUNS_SHARE]) {
    assert.equal(share.authority, 'com.haroon.deputy.applink');
    for (const c of share.columns) assert.equal(isSensitiveName(c), false, c);
  }
  assert.deepEqual([HEALTH_SHARE.uri(), WAITING_SHARE.uri(), RUNS_SHARE.uri()], [
    'content://com.haroon.deputy.applink/health',
    'content://com.haroon.deputy.applink/waiting',
    'content://com.haroon.deputy.applink/runs',
  ]);
});

test('no run column can carry what Deputy saw: no screen, step, shared text or summary', () => {
  for (const c of RUNS_SHARE.columns) assert.doesNotMatch(c, /screen|step|text|summary|shared|context|app/, c);
});

test('sample rows have exactly the share shape', () => {
  const rows = fixture('rows.sample.json') as { waiting: unknown[]; runs: unknown[] };
  for (const row of rows.waiting) assertRowShape(WAITING_SHARE, row);
  for (const row of rows.runs) assertRowShape(RUNS_SHARE, row);
  assert.throws(() => assertRowShape(RUNS_SHARE, { id: 1, task: 't', state: 'done', finished_at: 1, steps: '[]' }), /extra \[steps\]/);
});

test('the deputy-agent manifest follows the link rules, with only RunSuggestionActivity grandfathered', () => {
  const xml = read('main/AndroidManifest.xml');
  assert.deepEqual(auditManifest(xml, { allowHeadless: [RUN] }), []);
  assert.match(xml, /android:authorities="com\.haroon\.deputy\.applink"/);
  assert.match(xml, /<action android:name="com\.haroon\.deputy\.action\.PROPOSE_TASK" \/>/);
  const propose = xml.slice(xml.indexOf('ProposeTaskActivity'), xml.indexOf('</activity>', xml.indexOf('ProposeTaskActivity')));
  assert.doesNotMatch(propose, /NoDisplay|Translucent|noHistory/);
  assert.doesNotMatch(xml, /grantUriPermissions|grant-uri-permission/);
});
