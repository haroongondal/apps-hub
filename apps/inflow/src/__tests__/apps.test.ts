import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppRow } from 'inflow-core';
import { appRoute } from '../apps.ts';

const row = (over: Partial<AppRow>): AppRow => ({ label: 'App', pkgs: ['a'], lastAt: 1, today: 0, byContact: false, ...over });

test('a contact app opens its contact list', () => {
  assert.deepEqual(appRoute(row({ pkgs: ['com.google.android.apps.messaging'], byContact: true })), { kind: 'contacts', pkg: 'com.google.android.apps.messaging' });
});

test('several packages with one label open the items of all of them', () => {
  assert.deepEqual(appRoute(row({ label: 'Calendar', pkgs: ['b', 'a'] })), { kind: 'items', filter: { kind: 'apps', pkgs: ['b', 'a'] } });
});

test('one package opens that app', () => {
  assert.deepEqual(appRoute(row({ pkgs: ['a'] })), { kind: 'items', filter: { kind: 'app', pkg: 'a' } });
});
