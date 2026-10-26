import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNING_CERT_SHA256, type StoreApp } from '@apps-hub/store-manifest';
import { STORE_PACKAGE, appStatus, type Installed } from '../status.ts';

const app: StoreApp = {
  id: 'netlens',
  name: 'NetLens',
  changelog: '',
  android: {
    packageName: 'app.netlens',
    versionCode: 5,
    versionName: '0.2.0',
    minSdk: 24,
    apkPath: 'apps/netlens/android/5.apk',
    sha256: 'a'.repeat(64),
    signingCertSha256: SIGNING_CERT_SHA256,
    sizeBytes: 1,
  },
};
const installed = (over: Partial<Installed> = {}): Installed => ({
  versionCode: 5,
  versionName: '0.2.0',
  installer: STORE_PACKAGE,
  signingCertSha256: [SIGNING_CERT_SHA256],
  ...over,
});

test('not installed / up to date / update available', () => {
  assert.equal(appStatus(app, null).kind, 'not-installed');
  assert.deepEqual(appStatus(app, installed()), { kind: 'installed', label: 'Installed v0.2.0 (5)', action: null, warning: undefined });
  const s = appStatus(app, installed({ versionCode: 4, versionName: '0.1.0' }));
  assert.equal(s.kind, 'update');
  assert.equal(s.action, 'Update');
  assert.equal(s.warning, undefined);
});

test('foreign signing key blocks updating and explains the fix', () => {
  const s = appStatus(app, installed({ versionCode: 1, signingCertSha256: ['0'.repeat(64)] }));
  assert.equal(s.action, null);
  assert.match(s.warning ?? '', /different key/);
});

test('installed by another source offers a one-time reinstall', () => {
  const s = appStatus(app, installed({ installer: 'com.android.shell' }));
  assert.equal(s.action, 'Reinstall');
  assert.match(s.warning ?? '', /Not installed by Store/);
});

test('apps without an Android build are unavailable', () => {
  assert.equal(appStatus({ ...app, android: undefined }, null).kind, 'unavailable');
});
