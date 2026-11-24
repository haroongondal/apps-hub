import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { auditManifest } from '@apps-hub/app-link-contract';

import { TODAY_SHARE } from '../provided.ts';

const xml = fs.readFileSync(path.join(import.meta.dirname, '../../android/src/main/AndroidManifest.xml'), 'utf8');

test('manifest follows the link rules', () => {
  assert.deepEqual(auditManifest(xml), []);
});

test('manifest declares the link permission, holds it and can see the three apps', () => {
  assert.match(xml, /<permission android:name="com\.haroon\.permission\.AUTOPILOT" android:protectionLevel="signature" \/>/);
  assert.match(xml, /<uses-permission android:name="com\.haroon\.permission\.AUTOPILOT" \/>/);
  for (const pkg of ['com.haroon.inflow', 'com.haroon.deputy', 'com.haroon.clipboard']) assert.match(xml, new RegExp(`<package android:name="${pkg.replaceAll('.', '\\.')}" />`));
});

const providers = [...xml.matchAll(/<provider\b[^>]*>/g)].map((m) => m[0]);

test('the provider is exported, signature-guarded for reads and writes, and grants nothing', () => {
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.match(p, /android:name="expo\.modules\.nexuslinks\.android\.NexusLinkProvider"/);
  assert.match(p, new RegExp(`android:authorities="${TODAY_SHARE.authority.replaceAll('.', '\\.')}"`));
  assert.match(p, /android:exported="true"/);
  assert.match(p, /android:readPermission="com\.haroon\.permission\.AUTOPILOT"/);
  assert.match(p, /android:writePermission="com\.haroon\.permission\.AUTOPILOT"/);
  assert.doesNotMatch(p, /grantUriPermissions/);
  assert.doesNotMatch(xml, /path-permission|grant-uri-permission/);
  assert.equal(xml.match(/<permission\b/g)?.length, 1);
  assert.equal(xml.match(/<uses-permission\b/g)?.length, 1);
});

test('the audit fails when the provider loses its read permission or opens a path', () => {
  assert.notDeepEqual(auditManifest(xml.replace(/android:readPermission="[^"]*"/, '')), []);
  assert.notDeepEqual(auditManifest(xml.replace('android:readPermission="com.haroon.permission.AUTOPILOT"', 'android:readPermission="android.permission.INTERNET"')), []);
  assert.notDeepEqual(auditManifest(xml.replace('/>\n  </application>', '><path-permission android:pathPrefix="/today" android:readPermission="x" /></provider>\n  </application>')), []);
});
