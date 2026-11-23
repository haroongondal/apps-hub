import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  ADD_TODO, ADD_TODO_RESULTS, CHANGED_PING, LINK_PERMISSION, PROPOSE_TASK, PROPOSE_TASK_RESULTS, auditManifest, validateExtras, validateResult,
} from '../index.ts';
import type { Action, ExtraSpec } from '../index.ts';

// Same shape as extras-cases.json, so Deputy's and Inflow's Kotlin tests can run these files through AppLinkGuard.validateExtras.
interface Case { name: string; spec: Record<string, ExtraSpec>; raw: Record<string, unknown>; ok: boolean; reason?: string }
const read = (name: string): Case[] => JSON.parse(fs.readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));
const expand = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(expand)
    : typeof v === 'object' && v !== null && 'repeat' in v ? (v as { repeat: string }).repeat.repeat((v as unknown as { n: number }).n)
      : v;

test('action names', () => {
  assert.equal(PROPOSE_TASK.name, 'com.haroon.deputy.action.PROPOSE_TASK');
  assert.equal(ADD_TODO.name, 'com.haroon.inflow.action.ADD_TODO');
  assert.equal(PROPOSE_TASK.screen, true);
  assert.equal(ADD_TODO.screen, true);
});

const tables: [string, Action<Record<string, ExtraSpec>>][] = [['propose-task-extras.json', PROPOSE_TASK], ['add-todo-extras.json', ADD_TODO]];
for (const [file, action] of tables) {
  const cases = read(file);

  test(`${file} uses the live spec and covers valid, too long, wrong type, missing and unknown`, () => {
    for (const c of cases) assert.deepEqual(c.spec, action.extras, c.name);
    assert.equal(new Set(cases.map((c) => c.name)).size, cases.length);
    for (const reason of ['too long', 'text', 'whole number', 'missing extra', 'unknown extra']) {
      assert.ok(cases.some((c) => c.reason === reason), `${file} has no "${reason}" case`);
    }
    assert.ok(cases.some((c) => c.ok));
  });

  for (const c of cases) {
    test(`${action.name} extras: ${c.name}`, () => {
      const raw = Object.fromEntries(Object.entries(c.raw).map(([k, v]) => [k, expand(v)]));
      const r = validateExtras(action, raw);
      assert.equal(r.ok, c.ok, r.ok ? 'accepted' : r.reason);
      if (!r.ok && c.reason) assert.match(r.reason, new RegExp(c.reason));
    });
  }
}

test('result codes are valid action results', () => {
  for (const result of [...Object.values(PROPOSE_TASK_RESULTS), ...Object.values(ADD_TODO_RESULTS)]) {
    assert.deepEqual(validateResult(result), { ok: true, result });
  }
  assert.deepEqual(Object.keys(PROPOSE_TASK_RESULTS), ['handed_over', 'cancelled']);
  assert.deepEqual(Object.keys(ADD_TODO_RESULTS), ['added', 'cancelled']);
});

const P = LINK_PERMISSION;
const manifest = (app: string) =>
  `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="${P}" android:protectionLevel="signature" /><uses-permission android:name="${P}" /><application>${app}</application></manifest>`;
const activity = (action: string, attrs: string) =>
  `<activity android:name=".Link" android:exported="true" ${attrs}><intent-filter><action android:name="${action}" /></intent-filter></activity>`;

test('both actions follow the manifest rules: permission, and a screen (no NoDisplay)', () => {
  for (const { name } of [PROPOSE_TASK, ADD_TODO]) {
    assert.deepEqual(auditManifest(manifest(activity(name, `android:permission="${P}" android:theme="@style/Theme.App"`))), [], name);
    assert.equal(auditManifest(manifest(activity(name, `android:theme="@style/Theme.App"`))).length, 1, name);
    assert.match(auditManifest(manifest(activity(name, `android:permission="${P}" android:theme="@android:style/Theme.NoDisplay"`))).join(), /must show a screen/, name);
  }
});

test('CHANGED is a data-free ping to Halo, not a link action', () => {
  assert.deepEqual(CHANGED_PING, { action: 'com.haroon.autopilot.CHANGED', targetPackage: 'com.haroon.halo' });
  assert.ok(Object.isFrozen(CHANGED_PING));
  const receiver = (action: string) =>
    `<receiver android:name=".Changed" android:exported="true" android:permission="${P}"><intent-filter><action android:name="${action}" /></intent-filter></receiver>`;
  assert.deepEqual(auditManifest(manifest(receiver(CHANGED_PING.action))), []);
  assert.match(auditManifest(manifest(receiver(PROPOSE_TASK.name))).join(), /link actions must be activities/);
});
