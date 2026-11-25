import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHANGED_PING, LINK_PERMISSION, appHealthShare, assertRowShape, auditManifest, type Share } from '@apps-hub/app-link-contract';
import { normalize } from '../../modules/halo-engine/src/settings.ts';
import { READ_SHARES } from './link-shares.ts';

const engine = join(import.meta.dirname, '../../modules/halo-engine');
const read = (path: string) => fs.readFileSync(join(engine, path), 'utf8');
const shares = READ_SHARES as unknown as Record<string, Share<Record<string, unknown>>>;
const json = (path: string) => JSON.parse(read(path));
const kotlin = (file: string) => read(`android/src/main/java/expo/modules/haloengine/${file}`);
const manifest = read('android/src/main/AndroidManifest.xml');

test('fixtures/link-shares.json equals the shares Halo reads (LinkSharesTest binds the Kotlin readers to the same file)', () => {
  const live = Object.fromEntries(Object.entries(READ_SHARES).map(([k, s]) => [k, { authority: s.authority, path: s.path, columns: s.columns, maxRows: s.maxRows }]));
  assert.deepEqual(json('fixtures/link-shares.json'), live);
});

test('valid sample rows have exactly each share shape, invalid ones do not (the Kotlin readers skip the same rows)', () => {
  const rows = json('fixtures/link-rows.sample.json') as Record<'valid' | 'invalid' | 'badFlags', Record<string, unknown[]>>;
  for (const [name, share] of Object.entries(shares)) {
    assert.ok(rows.valid[name]?.length, name);
    for (const row of rows.valid[name]) assertRowShape(share, row);
    for (const row of rows.invalid[name] ?? []) assert.throws(() => assertRowShape(share, row), `${name} ${JSON.stringify(row)}`);
    // An int flag other than 0 or 1 fits the share's shape; only Halo's reader refuses it.
    for (const row of rows.badFlags[name] ?? []) assertRowShape(share, row);
  }
});

test("Halo's module manifest passes the link audit and declares the permission", () => {
  assert.deepEqual(auditManifest(manifest), []);
  assert.match(manifest, new RegExp(`<permission android:name="${LINK_PERMISSION}" android:protectionLevel="signature" />`));
  assert.match(manifest, new RegExp(`<uses-permission android:name="${LINK_PERMISSION}" />`));
  assert.doesNotMatch(manifest, /grantUriPermissions|grant-uri-permission/);
});

test('the CHANGED receiver is exported only to apps holding the link permission and takes only the ping', () => {
  const receiver = /<receiver\s[^>]*ChangedReceiver"[^>]*>[\s\S]*?<\/receiver>/.exec(manifest)?.[0] ?? '';
  assert.match(receiver, /android:exported="true"/);
  assert.match(receiver, new RegExp(`android:permission="${LINK_PERMISSION}"`));
  assert.deepEqual([...receiver.matchAll(/<action android:name="([^"]+)"/g)].map((m) => m[1]), [CHANGED_PING.action]);
  assert.equal(CHANGED_PING.targetPackage, 'com.haroon.halo');
  assert.match(kotlin('android/ChangedReceiver.kt'), new RegExp(`const val ACTION = "${CHANGED_PING.action}"`));
});

test('the provider serves the halo health share on its authority, read and write behind the permission', () => {
  const health = appHealthShare('halo');
  const provider = /<provider\s[^>]*HaloLinkProvider"[^>]*\/>/.exec(manifest)?.[0] ?? '';
  assert.match(provider, new RegExp(`android:authorities="${health.authority.replaceAll('.', '\\.')}"`));
  assert.match(provider, new RegExp(`android:readPermission="${LINK_PERMISSION}"`));
  assert.match(provider, new RegExp(`android:writePermission="${LINK_PERMISSION}"`));
  const rows = kotlin('core/HaloHealth.kt');
  assert.match(rows, new RegExp(`const val AUTHORITY = "${health.authority}"`));
  assert.match(rows, /arrayOf\(APP_ID, if \(accessibility\) 1 else 0, if \(listener\) 1 else 0, "none", lastSeenAt\)/);
  for (const row of [
    { app_id: 'halo', accessibility: 1, listener: 0, ai_source: 'none', last_seen_at: 1764000000000 },
    { app_id: 'halo', accessibility: 0, listener: 1, ai_source: 'none', last_seen_at: null },
  ]) assertRowShape(health, row);
});

test('every link switch is off by default and a document without links gives all off', () => {
  const s = normalize({});
  assert.deepEqual(s.links, { shieldPulse: false, waitingPulse: false, waitingAod: false, bubble: false, briefing: false, briefingPrivate: false });
});

test('the Links screen does not promise text on the locked always-on screen or hide amounts', () => {
  const src = fs.readFileSync(join(import.meta.dirname, '../LinksScreen.tsx'), 'utf8');
  assert.doesNotMatch(src, /Amounts are never shown|up to three short titles|short lines for the day/);
  assert.match(src, /only in the preview/);
});

test('the private briefing switch names the preview, not the always-on screen, which shows counts only', () => {
  const src = fs.readFileSync(join(import.meta.dirname, '../LinksScreen.tsx'), 'utf8');
  const row = /<SwitchRow\s+title="([^"]*)"\s+subtitle="([^"]*)"\s+value=\{l\.briefingPrivate\}/.exec(src);
  assert.ok(row, 'briefingPrivate switch not found');
  assert.equal(row[1], 'Show private briefing lines in the preview');
  assert.doesNotMatch(row[1], /always-on/);
  assert.match(row[2], /The always-on screen never shows them\./);
});

test('Links.stop and Links.clear both go through slot.cancel, which also frees the gate (RereadSlot is tested on the JVM)', () => {
  const links = kotlin('android/Links.kt');
  const body = (name: string) => new RegExp(`fun ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`).exec(links)?.[1] ?? '';
  assert.match(body('stop'), /slot\.cancel\(\)/);
  assert.match(body('clear'), /slot\.cancel\(\)/);
  assert.doesNotMatch(links, /gate\.cancel\(\)/);
  assert.match(kotlin('core/LinkTiming.kt'), /fun cancel\(\) \{\s*remove\(\)\s*gate\.cancel\(\)\s*\}/);
});
