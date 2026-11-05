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
const syncConfig = read('modules', 'strongroom-vault', 'android', 'src', 'main', 'java', 'expo', 'modules', 'strongroomvault', 'android', 'SyncConfig.kt');

const permissions = (xml: string) => [...xml.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const services = (xml: string) => [...xml.matchAll(/<service\b([^>]*)>/g)].map((m) => m[1]);
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

// Until sync has a server, INTERNET in release only helps a bad dependency send secrets out, so release drops it until BASE_URL is set.
test('the release build gets INTERNET only once sync has a server', () => {
  assert.ok(permissions(main).includes('android.permission.INTERNET'));
  const hasServer = !/const val BASE_URL = ""/.test(syncConfig);
  assert.deepEqual(permissions(release), hasServer ? [] : ['android.permission.INTERNET'], 'release removes INTERNET while BASE_URL is empty, and nothing else');
  if (!hasServer) assert.match(release, /android:name="android\.permission\.INTERNET" tools:node="remove"/);
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

// Phone proof builds (Task 6c) switch on with -P properties in debug only; a plain build and every release build stay as reviewed.
const gradle = read('android', 'app', 'build.gradle');
const moduleGradle = read('modules', 'strongroom-vault', 'android', 'build.gradle');
const mainActivity = read('android', 'app', 'src', 'main', 'java', 'com', 'haroon', 'strongroom', 'MainActivity.kt');
const syncTestManifest = read('android', 'app', 'src', 'syncTest', 'AndroidManifest.xml');
const syncTestNetwork = read('android', 'app', 'src', 'syncTest', 'res', 'xml', 'strongroom_sync_test_network.xml');
const PROOF_SWITCHES = ['strongroomIdSuffix', 'strongroomScreenshots', 'strongroomSyncUrl', 'strongroomSyncCa'];

function block(src: string, name: string): string {
  const start = src.search(new RegExp(`\\b${name}\\s*\\{`));
  assert.ok(start >= 0, `no ${name} block`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} block never closes`);
}

test('a plain build keeps FLAG_SECURE and the real app id', () => {
  assert.match(mainActivity, /if \(!BuildConfig\.ALLOW_SCREENSHOTS\) window\.addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/);
  const defaults = block(gradle, 'defaultConfig');
  assert.match(defaults, /applicationId 'com\.haroon\.strongroom'/);
  assert.match(defaults, /buildConfigField "boolean", "ALLOW_SCREENSHOTS", "false"/);
  assert.doesNotMatch(defaults, /applicationIdSuffix/);
  const debug = block(block(gradle, 'buildTypes'), 'debug');
  assert.match(debug, /if \(findProperty\('strongroomIdSuffix'\)\) \{/);
  assert.match(debug, /if \(findProperty\('strongroomScreenshots'\) == 'true'\) buildConfigField "boolean", "ALLOW_SCREENSHOTS", "true"/);
});

test('release builds ignore the phone proof switches', () => {
  const release = block(block(gradle, 'buildTypes'), 'release');
  for (const p of PROOF_SWITCHES) assert.doesNotMatch(release, new RegExp(p), `release reads ${p}`);
  assert.match(syncConfig, /const val BASE_URL = ""/);
  assert.match(block(moduleGradle, 'defaultConfig'), /buildConfigField "String", "TEST_SYNC_URL", '""'/);
  const moduleDebug = block(block(moduleGradle, 'buildTypes'), 'debug');
  assert.match(moduleDebug, /buildConfigField "String", "TEST_SYNC_URL", .*findProperty\('strongroomSyncUrl'\)/);
  assert.equal(moduleGradle.replace(moduleDebug, '').includes('strongroomSyncUrl'), false, 'only the debug build type reads strongroomSyncUrl');
  for (const xml of [main, release]) assert.doesNotMatch(xml, /networkSecurityConfig/);
  assert.match(gradle, /android\.sourceSets\.debug\.manifest\.srcFile 'src\/syncTest\/AndroidManifest\.xml'/);
  assert.deepEqual([...gradle.matchAll(/sourceSets\.(\w+)[^\n]*syncTest/g)].map((m) => m[1]), ['debug', 'debug']);
  assert.match(syncTestManifest, /android:networkSecurityConfig="@xml\/strongroom_sync_test_network"/);
  // The test cert is trusted once, inside <debug-overrides>, which Android applies only to a debuggable app.
  assert.match(syncTestNetwork, /<debug-overrides>\s*<trust-anchors>[^]*<certificates src="@raw\/strongroom_sync_ca" \/>[^]*<\/trust-anchors>\s*<\/debug-overrides>/);
  assert.equal(syncTestNetwork.match(/strongroom_sync_ca/g)?.length, 1);
});
