import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseIdsForDirs } from '../apps.ts';

test('releaseIdsForDirs maps changed package dirs to Store apps only', () => {
  assert.deepEqual(releaseIdsForDirs(['apps/open_tunnel_vpn', 'packages/ui', 'apps/store']), ['open-tunnel', 'store']);
  assert.deepEqual(releaseIdsForDirs(['apps/pdf-editor-mobile']), ['pdf-editor']);
  assert.deepEqual(releaseIdsForDirs(['apps/deputy', 'apps/deputy/modules/deputy-agent']), ['deputy']);
  assert.deepEqual(releaseIdsForDirs(['apps/pdf-editor-desktop', 'apps/netlens/modules/netlens-core']), []);
});
