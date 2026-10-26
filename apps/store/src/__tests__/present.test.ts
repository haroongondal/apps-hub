import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNING_CERT_SHA256, type StoreApp } from '@apps-hub/store-manifest';
import { STORE_PACKAGE, appStatus, type Installed } from '../status.ts';
import { installFailure, listSummary, statusPill, versionLines } from '../present.ts';

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
const old = installed({ versionCode: 4, versionName: '0.1.0' });

test('version lines show installed and, when newer, available', () => {
  assert.deepEqual(versionLines(app, null), [{ label: 'Available', version: '0.2.0 (5)' }]);
  assert.deepEqual(versionLines(app, installed()), [{ label: 'Installed', version: '0.2.0 (5)' }]);
  assert.deepEqual(versionLines(app, old), [
    { label: 'Installed', version: '0.1.0 (4)' },
    { label: 'Available', version: '0.2.0 (5)' },
  ]);
  assert.deepEqual(versionLines({ ...app, android: undefined }, null), []);
});

test('pill tone follows status; a foreign signing key is a warning', () => {
  assert.deepEqual(statusPill(appStatus(app, old)), { label: 'Update ready', tone: 'accent' });
  assert.deepEqual(statusPill(appStatus(app, installed())), { label: 'Installed', tone: 'ok' });
  assert.equal(statusPill(appStatus(app, installed({ signingCertSha256: ['0'.repeat(64)] }))).tone, 'warn');
  assert.equal(statusPill(appStatus(app, installed({ installer: null }))).tone, 'ok');
  assert.equal(statusPill(appStatus(app, null)).tone, 'neutral');
});

test('install failures: quiet on success or cancel, explained otherwise', () => {
  assert.equal(installFailure('SUCCESS', null), null);
  assert.equal(installFailure('FAILURE_ABORTED', 'user'), null);
  assert.match(installFailure('FAILURE_CONFLICT', 'x')!, /different key/);
  assert.match(installFailure('FAILURE_STORAGE', 'disk')!, /storage.*Android said: disk/);
  assert.equal(installFailure('FAILURE', null), 'Android stopped the install (FAILURE).');
});

test('list summary counts updates first', () => {
  assert.equal(listSummary([]), 'No apps published yet');
  assert.equal(listSummary([appStatus(app, old), appStatus(app, old)]), '2 updates ready to install');
  assert.equal(listSummary([appStatus(app, installed()), appStatus(app, null)]), 'Everything installed is up to date');
  assert.equal(listSummary([appStatus(app, null)]), '1 app ready to install');
});
