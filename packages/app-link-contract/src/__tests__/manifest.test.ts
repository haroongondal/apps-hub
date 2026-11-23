import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { auditManifest, LINK_PERMISSION } from '../index.ts';

const P = LINK_PERMISSION;
const manifest = (app: string, head = `<permission android:name="${P}" android:protectionLevel="signature" /><uses-permission android:name="${P}" />`) =>
  `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android">${head}<application>${app}</application></manifest>`;
const provider = (attrs = `android:readPermission="${P}" android:writePermission="${P}"`) =>
  `<provider android:name=".Share" android:authorities="com.haroon.inflow.applink" android:exported="true" ${attrs} />`;
const action = (attrs = `android:permission="${P}" android:theme="@style/Theme.App"`) =>
  `<activity android:name=".Open" android:exported="true" ${attrs}><intent-filter><action android:name="com.haroon.inflow.action.OPEN" /></intent-filter></activity>`;

test('a good manifest is clean', () => {
  assert.deepEqual(auditManifest(manifest(provider() + action())), []);
  // not a link: not exported, other authority, comment, queries entry
  const other = `<!-- <provider android:exported="true" android:authorities="com.haroon.inflow.applink" /> -->
    <provider android:name=".Media" android:authorities="com.haroon.inflow.media" android:exported="true" android:grantUriPermissions="true" />
    <activity android:name=".Run" android:exported="false" android:theme="@android:style/Theme.NoDisplay" />`;
  assert.deepEqual(auditManifest(manifest(other, '').replace('</manifest>', '<queries><provider android:authorities="com.haroon.inflow.autopilot" /></queries></manifest>')), []);
});

test('provider problems', () => {
  assert.deepEqual(auditManifest(manifest(provider(''))), ['provider .Share is exported with no readPermission']);
  assert.deepEqual(auditManifest(manifest(provider(`android:readPermission="android.permission.READ_SMS"`))), [
    `provider .Share readPermission is android.permission.READ_SMS, expected ${P}`,
  ]);
  assert.deepEqual(auditManifest(manifest(provider(`android:readPermission="${P}" android:writePermission="x.Y"`))), [
    `provider .Share writePermission is x.Y, expected ${P}`,
  ]);
  assert.deepEqual(auditManifest(manifest(provider(`android:readPermission="${P}" android:writePermission="${P}" android:grantUriPermissions="true"`))), [
    'provider .Share grants URI permissions',
  ]);
  assert.deepEqual(auditManifest(manifest(provider(`android:permission="${P}"`))), []);
  assert.deepEqual(auditManifest(manifest(provider(`android:readPermission="${P}"`).replace(' />', '><grant-uri-permission android:path="/" /></provider>'))), [
    'provider .Share grants URI permissions',
  ]);
});

test('action problems', () => {
  assert.deepEqual(auditManifest(manifest(action(''))), [`activity .Open is a link action but its permission is missing, expected ${P}`]);
  assert.deepEqual(auditManifest(manifest(action(`android:permission="x.Y"`))), [`activity .Open is a link action but its permission is x.Y, expected ${P}`]);
  const headless = action(`android:permission="${P}" android:theme="@android:style/Theme.NoDisplay"`);
  const problem = 'activity .Open is a link action that runs headless (@android:style/Theme.NoDisplay); link actions must show a screen';
  assert.deepEqual(auditManifest(manifest(headless)), [problem]);
  assert.deepEqual(auditManifest(manifest(headless), { allowHeadless: ['com.x.Closed'] }), [problem]);
  assert.deepEqual(auditManifest(manifest(headless), { allowHeadless: ['app.pkg.android.Open'] }), []);
  // intent-filter without a link action is no link action
  assert.deepEqual(auditManifest(manifest(`<activity android:name=".Main" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter></activity>`)), []);
  // no intent-filter, started by an explicit intent, headless: still a link action
  const explicit = `<activity android:name="a.b.Run" android:exported="true" android:permission="${P}" android:theme="@android:style/Theme.NoDisplay" />`;
  assert.equal(auditManifest(manifest(explicit)).length, 1);
  assert.deepEqual(auditManifest(manifest(explicit), { allowHeadless: ['a.b.Run'] }), []);
});

test('permission declaration problems', () => {
  assert.deepEqual(auditManifest(manifest(provider(), '')), [
    `${P} is used on a component but not declared with <permission>`,
    `${P} is used on a component but missing <uses-permission>`,
  ]);
  assert.deepEqual(auditManifest(manifest(provider(), `<permission android:name="${P}" android:protectionLevel="signature" />`)), [
    `${P} is used on a component but missing <uses-permission>`,
  ]);
  assert.deepEqual(auditManifest(manifest(provider(), `<permission android:name="${P}" android:protectionLevel="normal" /><uses-permission android:name="${P}" />`)), [
    `${P} protectionLevel is normal, expected signature`,
  ]);
  assert.deepEqual(auditManifest(manifest(provider(), `<permission android:name="${P}" /><uses-permission android:name="${P}" />`)), [
    `${P} protectionLevel is missing, expected signature`,
  ]);
});

const real = (rel: string) => fs.readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');
const INFLOW = 'apps/inflow/modules/inflow-core/android/src/main/AndroidManifest.xml';
const DEPUTY = 'apps/deputy/modules/deputy-agent/android/src/main/AndroidManifest.xml';
const RUN = 'expo.modules.deputyagent.android.RunSuggestionActivity';

test('the real Inflow manifest is clean', () => {
  assert.deepEqual(auditManifest(real(INFLOW)), []);
});

test('the real Deputy manifest has one grandfathered headless activity', () => {
  assert.deepEqual(auditManifest(real(DEPUTY)), [
    `activity ${RUN} is a link action that runs headless (@android:style/Theme.NoDisplay); link actions must show a screen`,
  ]);
  assert.deepEqual(auditManifest(real(DEPUTY), { allowHeadless: [RUN] }), []);
});

test('mutating the real Inflow manifest is caught', () => {
  const xml = real(INFLOW);
  assert.deepEqual(auditManifest(xml.replace(/android:readPermission="[^"]*"/, '')), ['provider .android.AutopilotProvider is exported with no readPermission']);
  assert.deepEqual(auditManifest(xml.replace('android:protectionLevel="signature"', 'android:protectionLevel="normal"')), [
    `${P} protectionLevel is normal, expected signature`,
  ]);
});
