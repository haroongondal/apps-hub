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
const serviceNamed = (xml: string, name: string) => {
  const tag = services(xml).find((s) => attr(s, 'android:name') === `expo.modules.strongroomvault.android.${name}`);
  assert.ok(tag, `${name} is declared`);
  return tag;
};
const serviceBlock = (xml: string, name: string) => {
  const block = xml.match(new RegExp(`<service\\b[^>]*android:name="expo\\.modules\\.strongroomvault\\.android\\.${name}"[\\s\\S]*?</service>`))?.[0];
  assert.ok(block, `the ${name} block exists`);
  return block;
};
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

test('the vault module keeps services private plus the keep-alive foreground service', () => {
  // RECEIVE_SMS (DESIGN 15.3): requested from the Settings toggle only, and the receiver handles only the incoming-message broadcast.
  // CAMERA (DESIGN 15.4): requested by the scan screen at scan time only.
  assert.deepEqual(permissions(vaultModule), [
    'android.permission.HIDE_OVERLAY_WINDOWS',
    'android.permission.QUERY_ALL_PACKAGES',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_SMS',
    'android.permission.CAMERA',
    'android.permission.NFC',
  ]);
  const autofill = serviceNamed(vaultModule, 'StrongroomAutofillService');
  const syncJob = serviceNamed(vaultModule, 'SyncJobService');
  const clipboardJob = serviceNamed(vaultModule, 'ClipboardClearJob');
  const keepAlive = serviceNamed(vaultModule, 'KeepAliveService');
  assert.equal(attr(autofill, 'android:name'), 'expo.modules.strongroomvault.android.StrongroomAutofillService');
  assert.deepEqual(
    [syncJob, clipboardJob].map((j) => attr(j, 'android:name')),
    ['expo.modules.strongroomvault.android.SyncJobService', 'expo.modules.strongroomvault.android.ClipboardClearJob'],
  );
  for (const job of [syncJob, clipboardJob]) {
    assert.equal(attr(job, 'android:exported'), 'false');
    assert.equal(attr(job, 'android:permission'), 'android.permission.BIND_JOB_SERVICE');
  }
  // Keep-alive: a private special-use foreground service, not a job service.
  assert.equal(attr(keepAlive, 'android:name'), 'expo.modules.strongroomvault.android.KeepAliveService');
  assert.equal(attr(keepAlive, 'android:exported'), 'false');
  assert.equal(attr(keepAlive, 'android:foregroundServiceType'), 'specialUse');
  assert.match(serviceBlock(vaultModule, 'KeepAliveService'), /android\.app\.PROPERTY_SPECIAL_USE_FGS_SUBTYPE/);
});

// The NFC tag service has to be exported for the system to bind it, and only the system may (BIND_NFC_SERVICE).
test('the NFC tag service is bindable by the system only and asks for an unlocked phone', () => {
  const tag = serviceNamed(vaultModule, 'StrongroomTagService');
  assert.equal(attr(tag, 'android:exported'), 'true');
  assert.equal(attr(tag, 'android:permission'), 'android.permission.BIND_NFC_SERVICE');
  const block = serviceBlock(vaultModule, 'StrongroomTagService');
  assert.match(block, /<intent-filter>\s*<action android:name="android\.nfc\.cardemulation\.action\.HOST_APDU_SERVICE" \/>\s*<\/intent-filter>/);
  assert.match(block, /<meta-data android:name="android\.nfc\.cardemulation\.host_apdu_service" android:resource="@xml\/strongroom_tag_service" \/>/);
  const xml = read('modules', 'strongroom-vault', 'android', 'src', 'main', 'res', 'xml', 'strongroom_tag_service.xml');
  assert.equal(attr(xml.match(/<host-apdu-service\b[^>]*>/)![0], 'android:requireDeviceUnlock'), 'true');
  assert.match(xml, /<aid-group android:category="other">\s*<aid-filter android:name="D2760000850101" \/>\s*<\/aid-group>/);
  const hce = vaultModule.match(/<uses-feature\b[^>]*android:name="android\.hardware\.nfc\.hce"[^>]*>/)?.[0];
  assert.ok(hce, 'the HCE feature is declared');
  assert.equal(attr(hce, 'android:required'), 'false');
});

test('backup stays off', () => {
  assert.match(main, /android:allowBackup="false"/);
});

// DESIGN 15.3: only the incoming-message broadcast; MMS and the inbox are never read (no READ_SMS, no SMS_DELIVER, no WAP push).
test('the SMS receiver listens to the incoming-message broadcast only', () => {
  const receiverBlock =
    vaultModule.match(/<receiver\b[^>]*android:name="expo\.modules\.strongroomvault\.android\.SmsReceiver"[\s\S]*?<\/receiver>/)?.[0] ?? '';
  assert.ok(receiverBlock, 'the SMS receiver is declared');
  assert.equal(attr(receiverBlock, 'android:exported'), 'true');
  assert.match(receiverBlock, /android\.provider\.Telephony\.SMS_RECEIVED/);
  assert.doesNotMatch(vaultModule, /SMS_RETRIEVED|SMS_DELIVER|READ_SMS|WAP_PUSH_RECEIVED|RECEIVE_MMS/);
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
  assert.match(syncConfig, /const val BASE_URL = "https:\/\/strongroom-vault\.[a-z0-9-]+\.workers\.dev"/);
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
