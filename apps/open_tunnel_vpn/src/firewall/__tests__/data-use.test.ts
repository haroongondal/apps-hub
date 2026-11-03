/**
 * Data-use sort and sum tests (node --test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppRule, DataUseRow } from '../../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

import { dataUseSince, joinAppUse, sortByMobile, totalBytes } from '../data-use.ts';

const rows: DataUseRow[] = [
  { uid: 1, wifiBytes: 900, cellBytes: 10 },
  { uid: 2, wifiBytes: 0, cellBytes: 500 },
  { uid: 3, wifiBytes: 50, cellBytes: 200 },
];

test('sortByMobile orders by cellular bytes, largest first', () => {
  assert.deepEqual(sortByMobile(rows).map((r) => r.uid), [2, 3, 1]);
});

test('sortByMobile keeps input order for equal cellular bytes', () => {
  const tied: DataUseRow[] = [
    { uid: 7, wifiBytes: 1, cellBytes: 0 },
    { uid: 8, wifiBytes: 2, cellBytes: 0 },
  ];
  assert.deepEqual(sortByMobile(tied).map((r) => r.uid), [7, 8]);
});

test('sortByMobile does not mutate its input', () => {
  const before = rows.map((r) => r.uid);
  sortByMobile(rows);
  assert.deepEqual(rows.map((r) => r.uid), before);
});

test('totalBytes adds Wi-Fi and cellular', () => {
  assert.equal(totalBytes({ uid: 3, wifiBytes: 50, cellBytes: 200 }), 250);
});

const apps: AppRule[] = [
  { uid: 1, pkg: 'com.b', label: 'Beta', rule: 'allow' },
  { uid: 2, pkg: 'com.a', label: 'alpha', rule: 'block_always' },
  { uid: 3, pkg: 'com.c', label: 'Chat', rule: 'block_on_mobile' },
  { uid: 4, pkg: 'com.d', label: 'Delta', rule: 'allow' },
];

test('joinAppUse lists every installed app, with zero use when there is no row', () => {
  const joined = joinAppUse(apps, [{ uid: 3, wifiBytes: 5, cellBytes: 700 }]);
  assert.equal(joined.length, apps.length);
  assert.deepEqual(joined.find((a) => a.uid === 1), {
    uid: 1,
    pkg: 'com.b',
    label: 'Beta',
    rule: 'allow',
    wifiBytes: 0,
    cellBytes: 0,
  });
});

test('joinAppUse puts mobile use first, then ties by name ignoring case', () => {
  const joined = joinAppUse(apps, [
    { uid: 3, wifiBytes: 0, cellBytes: 700 },
    { uid: 4, wifiBytes: 9, cellBytes: 100 },
  ]);
  assert.deepEqual(joined.map((a) => a.label), ['Chat', 'Delta', 'alpha', 'Beta']);
});

test('joinAppUse ignores use rows for UIDs that are not in the app list', () => {
  const joined = joinAppUse(apps, [{ uid: 999, wifiBytes: 1, cellBytes: 1 }]);
  assert.equal(joined.some((a) => a.uid === 999), false);
});

test('joinAppUse keeps each app\'s rule', () => {
  const joined = joinAppUse(apps, []);
  assert.equal(joined.find((a) => a.uid === 2)?.rule, 'block_always');
});

test('dataUseSince is local midnight today, or the first of this month', () => {
  const now = new Date(2026, 10, 3, 15, 30);
  assert.equal(dataUseSince('today', now), new Date(2026, 10, 3).getTime());
  assert.equal(dataUseSince('month', now), new Date(2026, 10, 1).getTime());
});
