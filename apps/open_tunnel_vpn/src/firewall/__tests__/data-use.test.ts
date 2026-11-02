/**
 * Data-use sort and sum tests (node --test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataUseRow } from '../../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

import { sortByMobile, totalBytes } from '../data-use.ts';

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
