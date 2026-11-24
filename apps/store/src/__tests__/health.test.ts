import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ANDROID_PACKAGES } from '@apps-hub/store-manifest';
import { SIBLING_PACKAGES, type HealthAppId } from '@apps-hub/app-link-contract';
import {
  AUTOSTART_STEPS,
  SERVICES,
  accessibilitySeen,
  appHealth,
  healthApps,
  listenerSeen,
  needsAutostart,
  parseHealthRow,
  reconcile,
  serviceEnabled,
  type HealthApp,
} from '../health.ts';

const NOW = Date.UTC(2026, 10, 24);
const app = (id: HealthAppId): HealthApp => ({ id, packageName: ANDROID_PACKAGES[id] });
const DEPUTY = 'com.haroon.deputy/expo.modules.deputyagent.android.DeputyAccessibilityService';
const HALO_LISTENER = 'com.haroon.halo/expo.modules.haloengine.android.HaloListener';
const row = (over: Record<string, unknown> = {}) => ({ app_id: 'deputy', accessibility: 1, listener: null, ai_source: 'hub', last_seen_at: NOW - 1000, ...over });

test('lists installed apps from the package table, HomeNet and TunnelWall included, never the Store or notch', () => {
  const all = healthApps(() => true).map((a) => a.id);
  assert.ok(all.includes('netlens') && all.includes('open-tunnel') && all.includes('ai-hub'));
  assert.ok(!all.includes('store' as HealthAppId) && !all.includes('notch' as HealthAppId));
  assert.deepEqual(healthApps((p) => p === 'app.netlens' || p === 'com.haroon.store'), [{ id: 'netlens', packageName: 'app.netlens' }]);
});

test('every health app id is a sibling with the same package, so native queryHealth finds its expected package by id', () => {
  for (const a of healthApps(() => true)) assert.equal(SIBLING_PACKAGES[a.id], a.packageName, a.id);
});

test('parses the secure setting like Deputy does: full and short component names, exact match', () => {
  assert.equal(serviceEnabled(`a.b/.X:${DEPUTY}`, 'com.haroon.deputy', 'expo.modules.deputyagent.android.DeputyAccessibilityService'), true);
  assert.equal(serviceEnabled('com.haroon.deputy/.android.Svc', 'com.haroon.deputy', 'com.haroon.deputy.android.Svc'), true);
  assert.equal(serviceEnabled(`${DEPUTY}Extra`, 'com.haroon.deputy', 'expo.modules.deputyagent.android.DeputyAccessibilityService'), false);
  assert.equal(serviceEnabled('com.haroon.deputyx/expo.modules.deputyagent.android.DeputyAccessibilityService', 'com.haroon.deputy', 'expo.modules.deputyagent.android.DeputyAccessibilityService'), false);
  assert.equal(serviceEnabled('', 'com.haroon.deputy', 'x'), false);
});

test('accessibility unset means off; a refused listener read means unknown, not off', () => {
  assert.equal(accessibilitySeen(DEPUTY, app('deputy')), 'on');
  assert.equal(accessibilitySeen(null, app('deputy')), 'off');
  assert.equal(accessibilitySeen(DEPUTY, app('netlens')), 'none');
  assert.equal(listenerSeen(null, app('halo')), 'unknown');
  assert.equal(listenerSeen('', app('halo')), 'off');
  assert.equal(listenerSeen(HALO_LISTENER, app('halo')), 'on');
  assert.equal(listenerSeen(HALO_LISTENER, app('deputy')), 'none');
});

test('accepts the contract sample rows for their own app', () => {
  const samples = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../../../packages/app-link-contract/fixtures/app-health-rows.sample.json'), 'utf8')) as { app_id: HealthAppId }[];
  for (const s of samples) assert.deepEqual(parseHealthRow([s], s.app_id, NOW), s);
});

test('anything off-contract is no report', () => {
  const bad: [string, unknown][] = [
    ['not a list', row()],
    ['no rows', []],
    ['two rows', [row(), row()]],
    ['other app', [row({ app_id: 'halo' })]],
    ['flag 2', [row({ accessibility: 2 })]],
    ['flag as text', [row({ listener: '1' })]],
    ['unknown ai source', [row({ ai_source: 'openai' })]],
    ['heartbeat before 2024', [row({ last_seen_at: 5 })]],
    ['heartbeat in the future', [row({ last_seen_at: NOW + 2 * 86_400_000 })]],
    ['heartbeat as text', [row({ last_seen_at: '1764000000000' })]],
    ['extra column', [row({ note: 'x' })]],
    ['missing column', [{ app_id: 'deputy', accessibility: 1, listener: null, ai_source: 'hub' }]],
    ['null row', [null]],
  ];
  for (const [why, rows] of bad) assert.equal(parseHealthRow(rows, 'deputy', NOW), null, why);
  assert.deepEqual(parseHealthRow([row({ last_seen_at: null })], 'deputy', NOW)?.last_seen_at, null);
});

test('settings first, report second, disagreement is not sure', () => {
  assert.equal(reconcile('on', undefined), 'on');
  assert.equal(reconcile('on', 1), 'on');
  assert.equal(reconcile('on', null), 'on');
  assert.equal(reconcile('off', 1), 'not-sure');
  assert.equal(reconcile('on', 0), 'not-sure');
  assert.equal(reconcile('unknown', 1), 'on');
  assert.equal(reconcile('unknown', undefined), 'unknown');
  assert.equal(reconcile('none', 0), 'off');
  assert.equal(reconcile('none', null), null);
});

test('plain words per app: on, off with what to do, not reported, AI source', () => {
  const ok = appHealth(app('deputy'), 'Deputy', { accessibility: DEPUTY, listeners: null }, row() as never);
  assert.deepEqual(ok.lines.map((l) => l.label), ['Accessibility: on', 'AI: from AI hub']);
  assert.equal(ok.needsLook, false);

  const off = appHealth(app('deputy'), 'Deputy', { accessibility: '', listeners: null }, null);
  assert.deepEqual(off.lines.map((l) => l.label), ['Accessibility: off', 'Not reported']);
  assert.equal(off.lines[0].fix, 'accessibility');
  assert.match(off.lines[0].todo ?? '', /turn it on/);
  assert.equal(off.needsLook, true);

  const halo = appHealth(app('halo'), 'Halo', { accessibility: '', listeners: null }, parseHealthRow([row({ app_id: 'halo', accessibility: 1, listener: 1, ai_source: 'none' })], 'halo', NOW));
  assert.deepEqual(halo.lines.map((l) => l.label), ['Accessibility: not sure', 'Notification access: on', 'AI: none']);

  const blocked = appHealth(app('inflow'), 'Inflow', { accessibility: null, listeners: null }, null);
  assert.deepEqual(blocked.lines.map((l) => [l.label, l.tone]), [['Notification access: unknown', 'neutral'], ['Not reported', 'neutral']]);
  assert.equal(blocked.needsLook, false);

  const homenet = appHealth(app('netlens'), 'HomeNet', { accessibility: DEPUTY, listeners: HALO_LISTENER }, null);
  assert.deepEqual(homenet.lines.map((l) => l.label), ['Not reported']);
  assert.equal(needsAutostart(app('netlens')), false);
  assert.equal(needsAutostart(app('halo')), true);
  assert.match(AUTOSTART_STEPS, /Autostart/);
});

test('copy has no engineering words', () => {
  const all = [
    appHealth(app('halo'), 'Halo', { accessibility: '', listeners: null }, null),
    appHealth(app('halo'), 'Halo', { accessibility: '', listeners: '' }, parseHealthRow([row({ app_id: 'halo', accessibility: 1, listener: 1 })], 'halo', NOW)),
  ].flatMap((h) => h.lines.flatMap((l) => [l.label, l.todo ?? '']));
  for (const text of [...all, AUTOSTART_STEPS]) assert.doesNotMatch(text, /Settings\.Secure|provider|share|null|component|SecurityException|uid/i, text);
});

test('the service table matches each app manifest and package', () => {
  const root = path.join(import.meta.dirname, '../../../..');
  const dirs: Record<string, string> = { deputy: 'deputy', clipboard: 'clipboard', halo: 'halo', inflow: 'inflow' };
  for (const [id, services] of Object.entries(SERVICES)) {
    const appDir = path.join(root, 'apps', dirs[id]);
    const appJson = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8')) as { expo: { android: { package: string } } };
    assert.equal(appJson.expo.android.package, ANDROID_PACKAGES[id as keyof typeof ANDROID_PACKAGES], id);
    const modules = path.join(appDir, 'modules');
    const tags = fs.readdirSync(modules)
      .map((m) => path.join(modules, m, 'android/src/main/AndroidManifest.xml'))
      .filter((f) => fs.existsSync(f))
      .flatMap((f) => fs.readFileSync(f, 'utf8').match(/<service\b[^>]*>/g) ?? []);
    const bound = (cls: string, perm: string) => tags.some((t) => t.includes(`android:name="${cls}"`) && t.includes(`android:permission="android.permission.${perm}"`));
    if (services.accessibility) assert.ok(bound(services.accessibility, 'BIND_ACCESSIBILITY_SERVICE'), `${id} accessibility`);
    if (services.listener) assert.ok(bound(services.listener, 'BIND_NOTIFICATION_LISTENER_SERVICE'), `${id} listener`);
  }
});
