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

const LINK_FILTER = '<intent-filter><action android:name="com.haroon.inflow.action.OPEN" /></intent-filter>';

test('an exported activity-alias without the permission is flagged when its target is a link action', () => {
  const target = `<activity android:name=".Open" android:exported="false" android:permission="${P}">${LINK_FILTER}</activity>`;
  const alias = (attrs: string) => `<activity-alias android:name=".OpenAlias" android:targetActivity=".Open" android:exported="true" ${attrs} />`;
  assert.deepEqual(auditManifest(manifest(target + alias(''))), [`activity-alias .OpenAlias is a link action but its permission is missing, expected ${P}`]);
  assert.deepEqual(auditManifest(manifest(target + alias(`android:permission="x.Y"`))), [`activity-alias .OpenAlias is a link action but its permission is x.Y, expected ${P}`]);
  assert.deepEqual(auditManifest(manifest(target + alias(`android:permission="${P}"`))), []);
  // an alias of an ordinary activity is not a link
  assert.deepEqual(auditManifest(manifest(`<activity android:name=".Main" android:exported="false" />` + alias('').replace('.Open"', '.Main"'))), []);
});

test('an activity-alias with a link action filter needs the permission, exported or not', () => {
  const alias = (attrs: string) => `<activity-alias android:name=".A" android:targetActivity=".Main" ${attrs}>${LINK_FILTER}</activity-alias>`;
  const problem = `activity-alias .A is a link action but its permission is missing, expected ${P}`;
  assert.deepEqual(auditManifest(manifest(alias(''))), [problem]);
  assert.deepEqual(auditManifest(manifest(alias('android:exported="false"'))), [problem]);
  assert.deepEqual(auditManifest(manifest(alias(`android:permission="${P}"`))), []);
});

test('a path-permission child of a link provider is flagged', () => {
  const withPath = provider().replace(' />', `><path-permission android:pathPrefix="/open" android:readPermission="android.permission.READ_SMS" /></provider>`);
  assert.deepEqual(auditManifest(manifest(withPath)), ['provider .Share has a path-permission, which replaces the provider permission for its path']);
});

test('an exported service or receiver with a link action filter is flagged', () => {
  const problem = (tag: string) => `${tag} .Do is exported with a link action filter; link actions must be activities that show a screen`;
  for (const tag of ['service', 'receiver']) {
    assert.deepEqual(auditManifest(manifest(`<${tag} android:name=".Do" android:exported="true" android:permission="${P}">${LINK_FILTER}</${tag}>`)), [problem(tag)], tag);
    // exported by default because it has a filter
    assert.deepEqual(auditManifest(manifest(`<${tag} android:name=".Do">${LINK_FILTER}</${tag}>`)), [problem(tag)], tag);
    assert.deepEqual(auditManifest(manifest(`<${tag} android:name=".Do" android:exported="false">${LINK_FILTER}</${tag}>`)), [], tag);
  }
});

test('android:exported given as a resource reference counts as exported', () => {
  assert.deepEqual(auditManifest(manifest(provider('').replace('exported="true"', 'exported="@bool/open"'))), ['provider .Share is exported with no readPermission']);
  assert.deepEqual(auditManifest(manifest(action('').replace('exported="true"', 'exported="@bool/open"'))), [`activity .Open is a link action but its permission is missing, expected ${P}`]);
  assert.deepEqual(auditManifest(manifest(`<service android:name=".Do" android:exported="@bool/open">${LINK_FILTER}</service>`)), [
    'service .Do is exported with a link action filter; link actions must be activities that show a screen',
  ]);
});

test('a translucent or finishing screen passes: the audit only reads the NoDisplay theme', () => {
  assert.deepEqual(auditManifest(manifest(action(`android:permission="${P}" android:theme="@style/Theme.Translucent"`))), []);
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
