import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Phase 2 adds INTERNET back for sync (DESIGN §6) and nothing else: the merged release manifest is checked with aapt2 at release time.
const app = join(import.meta.dirname, '..', '..');
const read = (...path: string[]) => readFileSync(join(app, ...path), 'utf8');
const main = read('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const release = read('android', 'app', 'src', 'release', 'AndroidManifest.xml');
const vaultModule = read('modules', 'strongroom-vault', 'android', 'src', 'main', 'AndroidManifest.xml');

const permissions = (xml: string) => [...xml.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const services = (xml: string) => [...xml.matchAll(/<service\b([^>]*)>/g)].map((m) => m[1]);
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

test('the release build keeps INTERNET', () => {
  assert.ok(permissions(main).includes('android.permission.INTERNET'));
  assert.deepEqual(permissions(release), [], 'the release manifest no longer removes (or adds) any permission');
});

test('the release build refuses cleartext traffic', () => {
  const application = release.match(/<application\b[^>]*>/)?.[0] ?? '';
  assert.equal(attr(application, 'android:usesCleartextTraffic'), 'false');
  assert.doesNotMatch(main, /usesCleartextTraffic="true"/);
});

test('the vault module adds one private job service and no permission', () => {
  assert.deepEqual(permissions(vaultModule), ['android.permission.HIDE_OVERLAY_WINDOWS', 'android.permission.QUERY_ALL_PACKAGES']);
  const [autofill, job, ...rest] = services(vaultModule);
  assert.equal(rest.length, 0);
  assert.equal(attr(autofill, 'android:name'), 'expo.modules.strongroomvault.android.StrongroomAutofillService');
  assert.equal(attr(job, 'android:name'), 'expo.modules.strongroomvault.android.SyncJobService');
  assert.equal(attr(job, 'android:exported'), 'false');
  assert.equal(attr(job, 'android:permission'), 'android.permission.BIND_JOB_SERVICE');
});

test('backup stays off', () => {
  assert.match(main, /android:allowBackup="false"/);
});
