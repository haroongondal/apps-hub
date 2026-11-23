import test from 'node:test';
import assert from 'node:assert/strict';

import type { ReconciledDevice } from '../device-repository.ts';
import { DEFAULT_HOME_WATCH_SETTINGS, homeWatchSnapshot, parseHomeWatchStatus } from '../home-watch.ts';

let nextId = 1;
function dev(over: Partial<ReconciledDevice> = {}): ReconciledDevice {
  const id = nextId++;
  return {
    id, networkId: 'net', identityKey: `key-${id}`, lastIp: `192.168.1.${id}`, hostname: null, customName: null,
    vendorOrModel: null, openPortsCsv: '', mdnsServicesCsv: '', isTrusted: false, firstSeenAt: 1, lastSeenAt: 1,
    mdnsName: null, friendlyName: null, model: null, netbiosName: null, person: null, mac: null, isNew: false,
    seenThisScan: false, ...over,
  };
}

test('every background setting is off by default and new-device checks run every 6 hours', () => {
  assert.deepEqual(DEFAULT_HOME_WATCH_SETTINGS, { whoIsHome: false, newDevices: false, newDeviceHours: 6, share: false, home: null });
});

test('snapshot: one entry per person (case-insensitive) with their addresses, newest first', () => {
  const rows = [
    dev({ person: 'Sara', lastIp: '192.168.1.20', lastSeenAt: 5 }),
    dev({ person: ' sara ', lastIp: '192.168.1.21', lastSeenAt: 9, seenThisScan: true }),
    dev({ person: 'Ali', lastIp: '192.168.1.30', lastSeenAt: 3 }),
    dev({ lastIp: '192.168.1.40', lastSeenAt: 7 }),
  ];
  const snap = homeWatchSnapshot(rows);
  assert.deepEqual(snap.people, [
    { label: 'sara', ips: ['192.168.1.21', '192.168.1.20'], seenNow: true, lastSeenAt: 9 },
    { label: 'Ali', ips: ['192.168.1.30'], seenNow: false, lastSeenAt: 3 },
  ]);
  assert.deepEqual(snap.known, [
    { ip: '192.168.1.21', lastSeenAt: 9, tagged: true },
    { ip: '192.168.1.40', lastSeenAt: 7, tagged: false },
    { ip: '192.168.1.20', lastSeenAt: 5, tagged: true },
    { ip: '192.168.1.30', lastSeenAt: 3, tagged: true },
  ]);
});

test('snapshot: two rows on one address merge, trusted counts as known for good, a person keeps at most 4 addresses', () => {
  const rows = [
    dev({ lastIp: '192.168.1.50', lastSeenAt: 2, isTrusted: true }),
    dev({ lastIp: '192.168.1.50', lastSeenAt: 8 }),
    ...[1, 2, 3, 4, 5].map((n) => dev({ person: 'Sara', lastIp: `192.168.1.${60 + n}`, lastSeenAt: n })),
  ];
  const snap = homeWatchSnapshot(rows);
  assert.deepEqual(snap.known.find((k) => k.ip === '192.168.1.50'), { ip: '192.168.1.50', lastSeenAt: 8, tagged: true });
  assert.equal(snap.people[0].ips.length, 4);
});

test('parse: anything but supported true is "not supported on this platform"', () => {
  assert.deepEqual(parseHomeWatchStatus({ supported: false }), { supported: false });
  assert.deepEqual(parseHomeWatchStatus(null), { supported: false });
  assert.deepEqual(parseHomeWatchStatus('yes'), { supported: false });
});

test('parse: a well-formed Android status passes through', () => {
  const raw = {
    supported: true,
    settings: { whoIsHome: true, newDevices: false, newDeviceHours: 12, share: true, home: { networkId: 'net_1', gatewayIp: '192.168.1.1', label: 'Home' } },
    people: [{ label: 'Sara', present: true, lastSeenAt: 9 }],
    newDevices: [{ ip: '192.168.1.50', firstSeenAt: 4, label: 'Computer', acknowledged: false }],
  };
  assert.deepEqual(parseHomeWatchStatus(raw), raw);
});

test('parse: bad fields fall back to safe values, never to "on"', () => {
  const parsed = parseHomeWatchStatus({
    supported: true,
    settings: { whoIsHome: 'true', newDevices: 1, newDeviceHours: 5, share: null, home: { networkId: 'n' } },
    people: [{ present: true }, 'x', { label: 'Ali', present: 'yes', lastSeenAt: Number.NaN }],
    newDevices: [{ label: 'x' }, { ip: '192.168.1.9', acknowledged: 1 }],
  });
  assert.deepEqual(parsed, {
    supported: true,
    settings: { whoIsHome: false, newDevices: false, newDeviceHours: 6, share: false, home: null },
    people: [{ label: 'Ali', present: false, lastSeenAt: 0 }],
    newDevices: [{ ip: '192.168.1.9', firstSeenAt: 0, label: 'Unknown device', acknowledged: false }],
  });
});
