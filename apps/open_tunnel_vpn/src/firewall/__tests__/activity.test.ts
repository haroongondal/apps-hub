/**
 * Activity filter and label tests (node --test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityEntry } from '../../../modules/open-tunnel-native/src/OpenTunnelNativeModule.ts';

import { activityRow, appLabel, filterActivity, NO_DOMAIN_LABEL } from '../activity.ts';

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

test('a missing domain is labelled as missing, never blank', () => {
  const row = activityRow(entry({ domain: null }));
  assert.ok(row.subtitle.startsWith(NO_DOMAIN_LABEL));
  assert.ok(row.subtitle.includes('93.184.216.34:443'));
});

test('a known domain leads the line, with the address after it', () => {
  const row = activityRow(entry({ domain: 'example.com', proto: 'udp', dstPort: 53 }));
  assert.equal(row.subtitle.split('\n')[0], 'example.com \u00b7 93.184.216.34:53 \u00b7 UDP');
});

test('an IPv6 address is bracketed so the port stays readable', () => {
  const row = activityRow(entry({ dst: '2001:db8::1', domain: 'example.com' }));
  assert.ok(row.subtitle.includes('[2001:db8::1]:443'));
});

test('the title is the app name when known, else the package, else Unknown app', () => {
  assert.equal(activityRow(entry({}), 'Chat').title, 'Chat');
  assert.equal(activityRow(entry({})).title, 'com.example.chat');
  assert.equal(activityRow(entry({ pkg: 'unknown' })).title, 'Unknown app');
});

test('the second line carries the clock time and both byte counts', () => {
  const at = new Date(2026, 10, 2, 9, 5, 7).getTime();
  const row = activityRow(entry({ timestampMs: at, bytesOut: 2048, bytesIn: 512 }));
  assert.equal(row.subtitle.split('\n')[1], '09:05:07 \u00b7 Sent 2 KB \u00b7 Received 512 B');
});
