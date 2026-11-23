import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const app = join(import.meta.dirname, '..', '..');
const manifest = (variant: string) => readFileSync(join(app, 'android', 'app', 'src', variant, 'AndroidManifest.xml'), 'utf8');
const granted = (xml: string) =>
  [...xml.matchAll(/<uses-permission\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/tools:node="remove"/.test(t)).map((t) => t.match(/android:name="([^"]+)"/)![1]);
const INTERNET = 'android.permission.INTERNET';

// Clipboard holds everything the owner copies; with no INTERNET a bad dependency can't send it anywhere. The merged release manifest is checked with :app:processReleaseMainManifest.
test('release has no INTERNET: main never asks for it and release removes what libraries merge in', () => {
  assert.ok(!granted(manifest('main')).includes(INTERNET));
  assert.match(manifest('release'), /<uses-permission android:name="android\.permission\.INTERNET" tools:node="remove"\/>/);
  assert.deepEqual(granted(manifest('release')), []);
});

test('only debug builds get INTERNET, for the Metro dev server', () => {
  for (const variant of ['debug', 'debugOptimized']) assert.ok(granted(manifest(variant)).includes(INTERNET), variant);
});

test('backup stays off', () => {
  assert.match(manifest('main'), /android:allowBackup="false"/);
});
