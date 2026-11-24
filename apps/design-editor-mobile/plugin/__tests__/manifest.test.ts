/**
 * What the share-target plugin declares, and that the committed android/ manifest already says the same
 * (running the plugin over it changes nothing), so a re-prebuild keeps the share sheet entry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('expo/config-plugins');
const plugin = require('../share-target.js');

type Attrs = Record<string, string>;
type Filter = { action?: { $: Attrs }[]; category?: { $: Attrs }[]; data?: { $: Attrs }[] };
type Activity = { $: Attrs; 'intent-filter'?: Filter[] };
type Manifest = { manifest: { application: { activity?: Activity[] }[] } };

const COMMITTED = join(import.meta.dirname, '../../android/app/src/main/AndroidManifest.xml');
const SEND = 'android.intent.action.SEND';
const SEND_MULTIPLE = 'android.intent.action.SEND_MULTIPLE';

const VIEW: Filter = {
  action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
  category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
  data: [{ $: { 'android:scheme': 'designeditor' } }],
};
const bare = (): Manifest => ({ manifest: { application: [{ activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [structuredClone(VIEW)] }] }] } });
const main = (m: Manifest) => m.manifest.application[0].activity![0];
const filterOf = (m: Manifest, action: string) => (main(m)['intent-filter'] ?? []).filter((f) => f.action?.some((a) => a.$['android:name'] === action));
const mimes = (f: Filter) => (f.data ?? []).map((d) => d.$['android:mimeType']);

test('SEND and SEND_MULTIPLE each accept pictures and videos and nothing else', () => {
  const m = plugin.configureManifest(bare());
  for (const action of [SEND, SEND_MULTIPLE]) {
    const [filter, ...extra] = filterOf(m, action);
    assert.equal(extra.length, 0);
    assert.deepEqual(mimes(filter), ['image/*', 'video/*']);
    assert.deepEqual(filter.category!.map((c) => c.$['android:name']), ['android.intent.category.DEFAULT']);
    assert.equal(filter.action!.length, 1);
  }
});

test('the existing filters stay and running twice adds nothing', () => {
  const once = plugin.configureManifest(bare());
  const twice = plugin.configureManifest(structuredClone(once));
  assert.deepEqual(twice, once);
  assert.deepEqual(filterOf(once, 'android.intent.action.VIEW'), [VIEW]);
  assert.equal(main(once)['intent-filter']!.length, 3);
});

test('a manifest without the main activity is refused rather than left without a share entry', () => {
  assert.throws(() => plugin.configureManifest({ manifest: { application: [{ activity: [] }] } }), /MainActivity/);
});

test('the committed manifest already has the filters the plugin makes, and the launcher entry', async () => {
  const committed = (await AndroidConfig.Manifest.readAndroidManifestAsync(COMMITTED)) as Manifest;
  const before = structuredClone(committed);
  plugin.configureManifest(committed);
  assert.deepEqual(committed, before);
  assert.equal(filterOf(committed, SEND).length, 1);
  assert.equal(filterOf(committed, SEND_MULTIPLE).length, 1);
  assert.equal(filterOf(committed, 'android.intent.action.MAIN').length, 1);
  assert.equal(main(committed).$['android:launchMode'], 'singleTask');
});
