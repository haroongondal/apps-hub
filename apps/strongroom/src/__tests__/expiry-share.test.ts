import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { appHealthShare, assertRowShape, auditManifest, isSensitiveName } from '@apps-hub/app-link-contract';
import { EXPIRY_SHARE, type ExpiryRow } from '../expiry-share.ts';

const vault = join(import.meta.dirname, '..', '..', 'modules', 'strongroom-vault', 'android', 'src');
const json = (name: string) => JSON.parse(readFileSync(join(vault, 'test', 'resources', name), 'utf8'));

test('the share equals expiry.share.json, which ExpiryLinkProviderShareTest binds the Kotlin provider to', () => {
  const { authority, path, columns, maxRows } = EXPIRY_SHARE;
  assert.deepEqual(json('expiry.share.json'), { authority, path, columns, maxRows });
  assert.equal(EXPIRY_SHARE.uri(), 'content://com.haroon.strongroom.applink/expiry');
});

test('no column is named like a secret, a card number, a holder or a site', () => {
  for (const c of EXPIRY_SHARE.columns) assert.equal(isSensitiveName(c), false, c);
  assert.deepEqual([...EXPIRY_SHARE.columns], ['kind', 'label', 'expires_on', 'days_left']);
});

test('sample rows have the share shape and say only kind, label and date', () => {
  const rows: ExpiryRow[] = json('expiry-rows.sample.json');
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assertRowShape(EXPIRY_SHARE, row);
    assert.ok(['card', 'pass'].includes(row.kind));
    assert.match(row.expires_on, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the vault module manifest follows the link rules', () => {
  const xml = readFileSync(join(vault, 'main', 'AndroidManifest.xml'), 'utf8');
  assert.deepEqual(auditManifest(xml), []);
  assert.match(xml, /android:authorities="com\.haroon\.strongroom\.applink"/);
  assert.doesNotMatch(xml, /grantUriPermissions/);
});

test('the health row share equals the contract fixture the Kotlin AppHealthShareTest copy is pinned to', () => {
  const share = appHealthShare('strongroom');
  const fixture = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'app-link-contract', 'fixtures', 'app-health.share.json'), 'utf8');
  assert.equal(readFileSync(join(vault, 'test', 'resources', 'app-health.share.json'), 'utf8'), fixture);
  assert.deepEqual(JSON.parse(fixture), { path: share.path, columns: share.columns, maxRows: share.maxRows });
  assert.equal(share.authority, 'com.haroon.strongroom.applink');
});

test('Strongroom declares no accessibility service, so the health row says accessibility is null', () => {
  const xml = readFileSync(join(vault, 'main', 'AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(xml, /BIND_ACCESSIBILITY_SERVICE|AccessibilityService/);
  assert.doesNotMatch(xml, /BIND_NOTIFICATION_LISTENER_SERVICE|NotificationListenerService/);
});
