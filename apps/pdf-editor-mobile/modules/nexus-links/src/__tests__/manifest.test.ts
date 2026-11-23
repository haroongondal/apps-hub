import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { auditManifest } from '@apps-hub/app-link-contract';

const xml = fs.readFileSync(path.join(import.meta.dirname, '../../android/src/main/AndroidManifest.xml'), 'utf8');

test('manifest follows the link rules', () => {
  assert.deepEqual(auditManifest(xml), []);
});

test('manifest declares the link permission, holds it and can see the three apps', () => {
  assert.match(xml, /<permission android:name="com\.haroon\.permission\.AUTOPILOT" android:protectionLevel="signature" \/>/);
  assert.match(xml, /<uses-permission android:name="com\.haroon\.permission\.AUTOPILOT" \/>/);
  for (const pkg of ['com.haroon.inflow', 'com.haroon.deputy', 'com.haroon.clipboard']) assert.match(xml, new RegExp(`<package android:name="${pkg.replaceAll('.', '\\.')}" />`));
});
