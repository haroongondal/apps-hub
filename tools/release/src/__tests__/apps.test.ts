import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANDROID_PACKAGES } from '@apps-hub/store-manifest';
import { APPS, releaseIdsForDirs } from '../apps.ts';

test('releaseIdsForDirs maps changed package dirs to Store apps only', () => {
  assert.deepEqual(releaseIdsForDirs(['apps/open_tunnel_vpn', 'packages/ui', 'apps/store']), ['open-tunnel', 'store']);
  assert.deepEqual(releaseIdsForDirs(['apps/pdf-editor-mobile']), ['pdf-editor']);
  assert.deepEqual(releaseIdsForDirs(['apps/deputy', 'apps/deputy/modules/deputy-agent']), ['deputy']);
  assert.deepEqual(releaseIdsForDirs(['apps/design-editor-mobile', 'apps/design-editor']), ['design-editor']);
  assert.deepEqual(releaseIdsForDirs(['apps/pdf-editor-desktop', 'apps/netlens/modules/netlens-core']), []);
});

test("the Store's package table covers every releasable app and matches its app.json", () => {
  assert.deepEqual(Object.keys(ANDROID_PACKAGES).sort(), Object.keys(APPS).sort());
  for (const app of Object.values(APPS)) {
    const appJson = JSON.parse(readFileSync(new URL(`../../../../${app.dir}/app.json`, import.meta.url), 'utf8'));
    assert.equal(app.android.packageName, appJson.expo.android.package, app.dir);
  }
});
