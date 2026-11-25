import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNING_CERT_SHA256,
  StoreAppSchema,
  androidPackageFor,
  StoreManifestSchema,
  AndroidReleaseSchema,
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

test('androidPackageFor returns the compiled-in package for a release id, never the manifest claim', () => {
  const lying = StoreAppSchema.parse({ id: 'netlens', name: 'HomeNet', changelog: '', android: { ...release(2), packageName: 'com.haroon.deputy' } });
  assert.equal(androidPackageFor(lying.id), 'app.netlens');
  assert.equal(androidPackageFor('store'), 'com.haroon.store');
  for (const id of ['evil', 'constructor', '__proto__', 'hasownproperty']) assert.equal(androidPackageFor(id), undefined);
});

const sha = 'ab12'.repeat(10);

test('commit is optional: old manifests without it still parse', () => {
  const m = upsertAndroidRelease(emptyManifest(), app, release(2));
  assert.equal(m.apps[0].android?.commit, undefined);
  assert.equal(StoreManifestSchema.safeParse(JSON.parse(JSON.stringify(m))).success, true);
});

test('commit accepts a 40-hex sha and rejects short, uppercase and garbage values', () => {
  const parse = (commit: unknown) => StoreManifestSchema.safeParse({
    ...emptyManifest(),
    apps: [{ id: 'netlens', name: 'NetLens', changelog: '', android: { ...release(2), commit } }],
  }).success;
  assert.equal(parse(sha), true);
  for (const bad of ['abc1234', sha.toUpperCase(), 'g'.repeat(40), `${sha}0`, '', 123]) assert.equal(parse(bad), false, String(bad));
});

test('upsertAndroidRelease keeps the commit and it survives a JSON round trip', () => {
  const m = upsertAndroidRelease(emptyManifest(), app, { ...release(2), commit: sha });
  assert.equal(m.apps[0].android?.commit, sha);
  const again = StoreManifestSchema.parse(JSON.parse(JSON.stringify(m)));
  assert.equal(again.apps[0].android?.commit, sha);
  const next = upsertAndroidRelease(again, app, { ...release(3), commit: 'cd34'.repeat(10) });
  assert.equal(next.apps[0].android?.commit, 'cd34'.repeat(10));
});

test('rolledBackFrom is optional, survives a round trip, and the next normal release clears it', () => {
  const from = { versionCode: 41, versionName: '0.3.0', commit: sha };
  const m = upsertAndroidRelease(emptyManifest(), app, { ...release(42), commit: 'cd34'.repeat(10), rolledBackFrom: from });
  assert.deepEqual(StoreManifestSchema.parse(JSON.parse(JSON.stringify(m))).apps[0].android?.rolledBackFrom, from);
  assert.equal(upsertAndroidRelease(m, app, release(43)).apps[0].android?.rolledBackFrom, undefined);
  assert.equal(upsertAndroidRelease(emptyManifest(), app, release(2)).apps[0].android?.rolledBackFrom, undefined);
});

test('rolledBackFrom rejects a bad shape, and a reader without the field still parses and drops it', () => {
  const parse = (rolledBackFrom: unknown) => AndroidReleaseSchema.safeParse({ ...release(2), rolledBackFrom }).success;
  assert.equal(parse({ versionCode: 41, versionName: '0.3.0' }), true);
  for (const bad of [{ versionCode: 0, versionName: 'x' }, { versionCode: 41 }, { versionCode: 41, versionName: 'x', commit: 'abc' }, 'x']) {
    assert.equal(parse(bad), false, JSON.stringify(bad));
  }
  // What a Store build from before this field does with a manifest that has it.
  const old = AndroidReleaseSchema.omit({ rolledBackFrom: true }).parse({ ...release(2), rolledBackFrom: { versionCode: 1, versionName: 'x' } });
  assert.equal('rolledBackFrom' in old, false);
});
