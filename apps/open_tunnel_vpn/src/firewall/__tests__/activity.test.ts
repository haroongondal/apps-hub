/**
 * Activity filter and label tests (node --test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityEntry } from '../../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

import { appLabel, filterActivity } from '../activity.ts';

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    timestampMs: 1000,
    uid: 10100,
    pkg: 'com.example.chat',
    proto: 'tcp',
    dst: '93.184.216.34',
    dstPort: 443,
    domain: null,
    bytesOut: 10,
    bytesIn: 20,
    verdict: 'allowed',
    ...over,
  };
}

const log = [
  entry({ timestampMs: 1, uid: 10100, verdict: 'allowed' }),
  entry({ timestampMs: 2, uid: 10100, verdict: 'blocked' }),
  entry({ timestampMs: 3, uid: 10200, verdict: 'blocked' }),
  entry({ timestampMs: 4, uid: 10200, verdict: 'allowed' }),
];

test('blockedOnly keeps only entries whose verdict is blocked', () => {
  const out = filterActivity(log, { blockedOnly: true });
  assert.deepEqual(out.map((e) => e.timestampMs), [2, 3]);
});

test('without blockedOnly every entry stays, in order', () => {
  const out = filterActivity(log, { blockedOnly: false });
  assert.deepEqual(out.map((e) => e.timestampMs), [1, 2, 3, 4]);
});

test('uid narrows to one app', () => {
  const out = filterActivity(log, { uid: 10200, blockedOnly: false });
  assert.deepEqual(out.map((e) => e.timestampMs), [3, 4]);
});

test('uid and blockedOnly combine', () => {
  const out = filterActivity(log, { uid: 10100, blockedOnly: true });
  assert.deepEqual(out.map((e) => e.timestampMs), [2]);
});

test('uid 0 is a real filter, not "no filter"', () => {
  const rows = [entry({ timestampMs: 1, uid: 0 }), entry({ timestampMs: 2, uid: 10100 })];
  assert.deepEqual(filterActivity(rows, { uid: 0, blockedOnly: false }).map((e) => e.timestampMs), [1]);
});

test('blocked is never inferred: an allowed entry for a blocked-looking app stays allowed', () => {
  // The entry carries no rule at all; the verdict is the only source.
  const rows = [entry({ timestampMs: 1, pkg: 'com.blocked.app', verdict: 'allowed' })];
  assert.deepEqual(filterActivity(rows, { blockedOnly: true }), []);
});

test('the input array is not mutated', () => {
  const copy = [...log];
  filterActivity(log, { blockedOnly: true });
  assert.deepEqual(log, copy);
});

test('unknown owners display as Unknown app', () => {
  assert.equal(appLabel('unknown'), 'Unknown app');
  assert.equal(appLabel('Unknown app'), 'Unknown app');
});

test('a real package name is shown as is', () => {
  assert.equal(appLabel('com.example.chat'), 'com.example.chat');
});
