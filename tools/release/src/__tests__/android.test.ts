import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAppsHubGradle, parseBadging, parseSignerSha256 } from '../android.ts';

test('parseBadging reads package, versions and minSdk', () => {
  const out = [
    "package: name='app.netlens' versionCode='2' versionName='0.1.0' platformBuildVersionName='16' platformBuildVersionCode='36'",
    "minSdkVersion:'24'",
    "targetSdkVersion:'36'",
  ].join('\n');
  assert.deepEqual(parseBadging(out), { packageName: 'app.netlens', versionCode: 2, versionName: '0.1.0', minSdk: 24 });
  assert.throws(() => parseBadging('garbage'), /could not parse/);
});

test('parseSignerSha256 returns every signer digest', () => {
  const d = 'e3af4a92b1e858ede650bf53521c9be86702036100b2dc07393a262748d0317d';
  const out = `Signer #1 certificate DN: CN=x\nSigner #1 certificate SHA-256 digest: ${d}\nSigner #1 certificate SHA-1 digest: ab`;
  assert.deepEqual(parseSignerSha256(out), [d]);
  assert.deepEqual(parseSignerSha256('nothing'), []);
});

test('applyAppsHubGradle wires signing and version overrides into the Expo template, once', () => {
  const template = readFileSync(new URL('./expo-template.build.gradle', import.meta.url), 'utf8');
  const out = applyAppsHubGradle(template);
  assert.match(out, /versionCode findProperty\('appsHubVersionCode'\)\?\.toInteger\(\) \?: 1\n/);
  assert.match(out, /versionName findProperty\('appsHubVersionName'\) \?: "0\.1\.0"/);
  assert.match(out, /storeFile file\(findProperty\('APPS_HUB_RELEASE_STORE_FILE'\)\)/);
  assert.equal(out.match(/findByName\('release'\) \?: signingConfigs\.debug/g)?.length, 1);
  assert.equal(out.match(/signingConfig signingConfigs\.debug/g)?.length, 1);
  assert.equal(applyAppsHubGradle(out), out);
});

test('applyAppsHubGradle refuses a build.gradle that drifted from the template', () => {
  assert.throws(() => applyAppsHubGradle('android { defaultConfig { versionCode 1 } }'), /no longer matches/);
});
