import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNING_CERT_SHA256,
  StoreManifestSchema,
  emptyManifest,
  nextVersionCode,
  upsertAndroidRelease,
  type AndroidRelease,
} from '../index.ts';

const release = (versionCode: number): AndroidRelease => ({
  packageName: 'app.netlens',
  versionCode,
  versionName: '0.1.0',
  minSdk: 24,
  apkPath: `apps/netlens/android/${versionCode}.apk`,
  sha256: 'a'.repeat(64),
  signingCertSha256: SIGNING_CERT_SHA256,
  sizeBytes: 1000,
});
const app = { id: 'netlens', name: 'NetLens', changelog: 'first' };

test('nextVersionCode starts above the in-repo default and increments', () => {
  const m = emptyManifest();
  assert.equal(nextVersionCode(m, 'netlens'), 2);
  assert.equal(nextVersionCode(upsertAndroidRelease(m, app, release(2)), 'netlens'), 3);
});

test('upsert replaces the existing entry and keeps other apps', () => {
  let m = upsertAndroidRelease(emptyManifest(), app, release(2));
  m = upsertAndroidRelease(m, { id: 'store', name: 'Store', changelog: '' }, { ...release(2), packageName: 'com.haroon.store' });
  m = upsertAndroidRelease(m, { ...app, changelog: 'second' }, release(3));
  assert.equal(m.apps.length, 2);
  assert.equal(m.apps[0].android?.versionCode, 3);
  assert.equal(m.apps[0].changelog, 'second');
});

test('upsert rejects a non-monotonic versionCode', () => {
  const m = upsertAndroidRelease(emptyManifest(), app, release(5));
  assert.throws(() => upsertAndroidRelease(m, app, release(5)), /must exceed/);
});

test('schema rejects bad hashes and wrong schemaVersion', () => {
  const ok = upsertAndroidRelease(emptyManifest(), app, release(2));
  assert.equal(StoreManifestSchema.safeParse(ok).success, true);
  assert.equal(StoreManifestSchema.safeParse({ ...ok, schemaVersion: 2 }).success, false);
  const bad = { ...ok, apps: [{ ...ok.apps[0], android: { ...release(2), sha256: 'XYZ' } }] };
  assert.equal(StoreManifestSchema.safeParse(bad).success, false);
});
