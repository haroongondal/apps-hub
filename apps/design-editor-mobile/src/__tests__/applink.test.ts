import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LINK_PERMISSION, appHealthShare, assertRowShape, auditManifest } from '@apps-hub/app-link-contract';

const MANIFEST = readFileSync(new URL('../../modules/design-media/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const PROVIDER = readFileSync(new URL('../../modules/design-media/android/src/main/java/expo/modules/designmedia/core/AppLinks.kt', import.meta.url), 'utf8');
const share = appHealthShare('design-editor');

test('the module manifest follows the link rules', () => {
  assert.deepEqual(auditManifest(MANIFEST), []);
  assert.match(MANIFEST, new RegExp(`<permission android:name="${LINK_PERMISSION}" android:protectionLevel="signature" />`));
  assert.match(MANIFEST, new RegExp(`<uses-permission android:name="${LINK_PERMISSION}" />`));
  assert.doesNotMatch(MANIFEST, /grantUriPermissions|grant-uri-permission/);
});

test('the provider serves the health share at its authority, and only there', () => {
  assert.equal(share.authority, 'com.haroon.designeditor.applink');
  assert.match(MANIFEST, new RegExp(`android:authorities="${share.authority.replace(/\./g, '\\.')}"`));
  assert.ok(PROVIDER.includes(`const val AUTHORITY = "${share.authority}"`));
  assert.ok(PROVIDER.includes(`const val PATH = "${share.path}"`));
  assert.ok(PROVIDER.includes(`const val APP_ID = "design-editor"`));
});

test('the row Design Editor serves has the share shape', () => {
  assertRowShape(share, { app_id: 'design-editor', accessibility: null, listener: null, ai_source: 'none', last_seen_at: null });
  assertRowShape(share, { app_id: 'design-editor', accessibility: null, listener: null, ai_source: 'hub', last_seen_at: 1_764_000_000_000 });
});
