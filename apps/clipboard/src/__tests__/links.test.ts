import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { assertRowShape, auditManifest, isSensitiveName } from '@apps-hub/app-link-contract';
import { HEALTH_SHARE, PINNED_SHARE } from '../links.ts';

const MODULE = path.join(import.meta.dirname, '..', '..', 'modules', 'clipboard-core', 'android', 'src');
const read = (rel: string) => fs.readFileSync(path.join(MODULE, rel), 'utf8');
const fixture = (name: string): unknown => JSON.parse(read(`test/resources/applink/${name}`));
const kotlin = (rel: string) => read(`main/java/expo/modules/clipboardcore/${rel}`);

test('pinned equals the fixture ClipLinksTest.kt binds the provider to', () => {
  const { authority, path: p, columns, maxRows } = PINNED_SHARE;
  assert.deepEqual(fixture('pinned.share.json'), { authority, path: p, columns, maxRows });
});

test('both shares sit on the Clipboard authority, page by id, and name nothing like a secret', () => {
  for (const share of [HEALTH_SHARE, PINNED_SHARE]) {
    assert.equal(share.authority, 'com.haroon.clipboard.applink');
    for (const c of share.columns) assert.equal(isSensitiveName(c), false, c);
  }
  assert.equal(HEALTH_SHARE.uri(), 'content://com.haroon.clipboard.applink/health');
  assert.equal(PINNED_SHARE.uri(), 'content://com.haroon.clipboard.applink/pinned');
  assert.equal(PINNED_SHARE.uri(41), 'content://com.haroon.clipboard.applink/pinned/41');
  for (const c of PINNED_SHARE.columns) assert.doesNotMatch(c, /kind|mime|uri|image|file|hidden|sensitive/, c);
});

test('sample rows have exactly the share shape', () => {
  const rows = fixture('rows.sample.json') as { pinned: unknown[]; health: unknown[] };
  for (const row of rows.pinned) assertRowShape(PINNED_SHARE, row);
  for (const row of rows.health) assertRowShape(HEALTH_SHARE, row);
  assert.throws(() => assertRowShape(PINNED_SHARE, { id: 1, text: 't', pinned_at: 1, from_app: '', kind: 'secret' }), /extra \[kind\]/);
});

test('the Kotlin rows use the share columns, Nexus as the only pinned reader, and the health values', () => {
  const links = kotlin('core/ClipLinks.kt');
  const cols = (name: string) => links.match(new RegExp(`${name} = arrayOf\\(([^)]*)\\)`))?.[1].split(',').map((s) => JSON.parse(s.trim()));
  assert.deepEqual(cols('PINNED_COLUMNS'), [...PINNED_SHARE.columns]);
  assert.deepEqual(cols('HEALTH_COLUMNS'), [...HEALTH_SHARE.columns]);
  assert.match(links, /const val NEXUS_PACKAGE = "com\.haroon\.pdfeditor"/);
  assert.match(links, /arrayOf\("clipboard", if \(accessibilityOn\) 1 else 0, null, "none", lastSeenAt\)/);
});

test('the clipboard-core manifest follows the link rules and declares the provider on the share authority', () => {
  const xml = read('main/AndroidManifest.xml');
  assert.deepEqual(auditManifest(xml), []);
  assert.match(xml, /android:authorities="com\.haroon\.clipboard\.applink"/);
  assert.doesNotMatch(xml, /grantUriPermissions|grant-uri-permission|INTERNET/);
});

test('the provider checks the guard and the calling package before it reads, and never writes', () => {
  const provider = kotlin('android/ClipLinkProvider.kt');
  const query = provider.slice(provider.indexOf('override fun query'), provider.indexOf('private fun cursor'));
  const at = (s: string) => query.indexOf(s);
  assert.ok(at('AppLinkCaller.allowed(c)') > 0 && at('AppLinkCaller.allowed(c)') < at('ClipStore.get(c)'));
  assert.ok(at('callingPackage') > 0 && at('callingPackage') < at('pinnedRows'));
  assert.match(query, /pinnedReader\(store\.nexusReadsPinned\(\), caller\)/);
  assert.doesNotMatch(query, /heartbeat|setNexus|writableDatabase/);
  for (const m of ['insert', 'update', 'delete']) assert.match(provider, new RegExp(`override fun ${m}\\([^)]*\\)[^=]*= throw UnsupportedOperationException`));
  assert.doesNotMatch(provider, /override fun call\(/);
});
