import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repo = path.resolve(import.meta.dirname, '../../../..');
const AIDL = 'android/src/main/aidl/expo/modules/aihubcore';
const hub = path.join(repo, 'apps/ai-hub/modules/ai-hub-core', AIDL);
const copy = path.join(repo, 'packages/ai-hub-client', AIDL);

test('the client carries the same AIDL files as the hub, byte for byte', () => {
  const names = fs.readdirSync(hub).sort();
  assert.deepEqual(names, ['IAiHub.aidl', 'IAiHubCallback.aidl']);
  assert.deepEqual(fs.readdirSync(copy).sort(), names);
  for (const n of names) assert.equal(fs.readFileSync(path.join(copy, n), 'utf8'), fs.readFileSync(path.join(hub, n), 'utf8'), n);
});

test('the client manifest holds the hub permission, declares it as signature and can see the hub', () => {
  const xml = fs.readFileSync(path.join(repo, 'packages/ai-hub-client/android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(xml, /<uses-permission android:name="com\.haroon\.permission\.AI_HUB" \/>/);
  assert.match(xml, /<permission android:name="com\.haroon\.permission\.AI_HUB" android:protectionLevel="signature" \/>/);
  assert.match(xml, /<queries>\s*<package android:name="com\.haroon\.aihub" \/>\s*<\/queries>/);
  const hubXml = fs.readFileSync(path.join(repo, 'apps/ai-hub/modules/ai-hub-core/android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(hubXml, /<permission android:name="com\.haroon\.permission\.AI_HUB" android:protectionLevel="signature" \/>/);
  assert.match(hubXml, /<action android:name="com\.haroon\.aihub\.BIND" \/>/);
});
