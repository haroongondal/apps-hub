import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LINK_PERMISSION, auditManifest } from '@apps-hub/app-link-contract';

const read = (rel: string) => fs.readFileSync(path.join(import.meta.dirname, rel), 'utf8');
const MODULE = read('../../modules/store-installer/android/src/main/AndroidManifest.xml');
const APP = read('../../android/app/src/main/AndroidManifest.xml');

test('Store manifests follow the link rules', () => {
  assert.deepEqual(auditManifest(MODULE), []);
  assert.deepEqual(auditManifest(APP), []);
});

test('Store holds the link permission as a signature permission, to read health rows', () => {
  const declared = MODULE.match(/<permission\b[^>]*>/g) ?? [];
  assert.ok(declared.some((t) => t.includes(`android:name="${LINK_PERMISSION}"`) && t.includes('android:protectionLevel="signature"')));
  assert.ok((MODULE.match(/<uses-permission\b[^>]*>/g) ?? []).some((t) => t.includes(`android:name="${LINK_PERMISSION}"`)));
  // QUERY_ALL_PACKAGES makes every sibling's provider visible, so no per-app <queries> entry is needed.
  assert.match(MODULE, /android\.permission\.QUERY_ALL_PACKAGES/);
});
