import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ADD_TODO, assertRowShape, auditManifest, defineShare } from '@apps-hub/app-link-contract';
import type { Share } from '@apps-hub/app-link-contract';
import { AUTHORITY } from '../index.ts';
import { INFLOW_ASK_IDS_SHARE, INFLOW_ASK_ITEMS_SHARE, INFLOW_BRIEFING_SHARE, INFLOW_DEBITS_SHARE, INFLOW_HEALTH_SHARE } from '../inflow-shares.ts';

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

const nexusShares: [string, Share<Record<string, unknown>>][] = [
  ['ask-items', INFLOW_ASK_ITEMS_SHARE],
  ['ask-ids', INFLOW_ASK_IDS_SHARE],
  ['debits', INFLOW_DEBITS_SHARE],
];

test('the three Nexus shares equal the fixtures the Kotlin provider is tested against, and their sample rows pass the shape', () => {
  for (const [name, share] of nexusShares) {
    const { authority, path, columns, maxRows } = share;
    assert.deepEqual(json(`packages/autopilot-contract/fixtures/${name}.share.json`), { authority, path, columns, maxRows }, name);
    assert.equal(share.uri(12), `content://com.haroon.inflow.autopilot/${path}/12`);
    assert.throws(() => share.uri(-1));
    const rows: unknown[] = json(`packages/autopilot-contract/fixtures/${name}-rows.sample.json`);
    assert.ok(rows.length > 0 && rows.length <= maxRows, name);
    for (const row of rows) assertRowShape(share, row);
  }
});

// Copied from what Nexus reads (eco/nexus: apps/pdf-editor-mobile/modules/nexus-links/fixtures/reader-shares.json and Readers.SPECS): Nexus drops rows whose columns differ.
const NEXUS_READS = {
  ask_items: { columns: [['id', 'long'], ['app', 'string'], ['sender', 'string?'], ['text', 'string'], ['at', 'long']], maxRows: 200 },
  ask_ids: { columns: [['id', 'long']], maxRows: 200 },
  debits: { columns: [['id', 'long'], ['amount_minor', 'long'], ['at', 'long'], ['merchant', 'string'], ['account', 'string']], maxRows: 200 },
};

test("the Nexus shares serve exactly the columns, types, paths and row cap Nexus's reader expects", () => {
  for (const [, share] of nexusShares) {
    const want = NEXUS_READS[share.path as keyof typeof NEXUS_READS];
    assert.equal(share.authority, 'com.haroon.inflow.autopilot');
    assert.deepEqual(share.columns.map((c) => [c, share.types[c]]), want.columns, share.path);
    assert.equal(share.maxRows, want.maxRows);
  }
});

test('a debit row with a card number for an account, a fractional amount or a missing merchant fails; text is capped in the samples', () => {
  const ok = { id: 7, amount_minor: 420000, at: 1764000000000, merchant: 'Imtiaz', account: 'Meezan ****1234' };
  assertRowShape(INFLOW_DEBITS_SHARE, ok);
  assert.throws(() => assertRowShape(INFLOW_DEBITS_SHARE, { ...ok, amount_minor: 1.5 }), /amount_minor must be long/);
  const { merchant: _m, ...noMerchant } = ok;
  assert.throws(() => assertRowShape(INFLOW_DEBITS_SHARE, noMerchant), /missing \[merchant\]/);
  const debits: { account: string }[] = json('packages/autopilot-contract/fixtures/debits-rows.sample.json');
  assert.ok(debits.every((r) => (r.account.match(/\d/g) ?? []).length <= 4));
  const asks: { text: string }[] = json('packages/autopilot-contract/fixtures/ask-items-rows.sample.json');
  assert.ok(asks.every((r) => r.text.length <= 4000));
  assert.throws(() => assertRowShape(INFLOW_ASK_ITEMS_SHARE, { id: 1, app: 'Messages', sender: undefined, text: 'x', at: 1 }), /sender must be string\?/);
});
