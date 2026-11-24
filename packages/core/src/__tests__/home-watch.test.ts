import test from 'node:test';
import assert from 'node:assert/strict';

import type { ReconciledDevice } from '../device-repository.ts';
import { DEFAULT_HOME_WATCH_SETTINGS, homeWatchSnapshot, parseHomeWatchStatus, postScanSyncHome, orderHomeWatch, readHomeRouter, routerIdOf } from '../home-watch.ts';

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
    settings: { whoIsHome: true, newDevices: false, newDeviceHours: 12, share: true, home: {
        networkId: 'net_1',
        gatewayIp: '192.168.1.1',
        label: 'Home',
        routerId: 'uuid:home-router-1',
        routerUrl: 'http://192.168.1.1:5000/rootDesc.xml',
      },
    },
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

// The saved home is the router itself, not only its address (twin: HomeRouter in Kotlin, HomeRulesTest).

const lan = { localIp: '192.168.1.20', cidrPrefix: 24, gatewayIp: '192.168.1.1' };
const desc = (udn: string): string =>
  `<root><device><UDN>${udn}</UDN><deviceList><device><UDN>uuid:wan-1</UDN></device></deviceList></device></root>`;

function routerBinding(bodies: Record<string, string | null>) {
  const asked: string[] = [];
  return {
    asked,
    async tcpFetch(ip: string, port: number, request: string): Promise<string | null> {
      const key = `${ip}:${port}${request.split(' ')[1]}`;
      asked.push(key);
      const body = bodies[key];
      return body == null ? null : `HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n\r\n${body}`;
    },
  };
}

test('routerIdOf: the first UDN is the router; none means no ID', () => {
  assert.equal(routerIdOf(desc('uuid:home-router-1')), 'uuid:home-router-1');
  assert.equal(routerIdOf('<root><device><friendlyName>x</friendlyName></device></root>'), null);
  assert.equal(routerIdOf('<UDN>not-a-uuid</UDN>'), null);
});

test('readHomeRouter: reads the ID from a description on the gateway only', async () => {
  const b = routerBinding({
    '192.168.1.7:80/d.xml': desc('uuid:printer'),
    '192.168.1.1:1900/none.xml': '<root/>',
    '192.168.1.1:5000/rootDesc.xml': desc('uuid:home-router-1'),
  });
  const urls = ['http://192.168.1.7/d.xml', 'http://192.168.1.1:1900/none.xml', 'http://192.168.1.1:5000/rootDesc.xml'];
  assert.deepEqual(await readHomeRouter(b, lan, urls), {
    routerId: 'uuid:home-router-1',
    routerUrl: 'http://192.168.1.1:5000/rootDesc.xml',
  });
  assert.deepEqual(b.asked, ['192.168.1.1:1900/none.xml', '192.168.1.1:5000/rootDesc.xml']);
});

test('readHomeRouter: a router that gives no ID (or no description) is null, so home is not saved', async () => {
  assert.equal(await readHomeRouter(routerBinding({ '192.168.1.1:80/d.xml': '<root/>' }), lan, ['http://192.168.1.1/d.xml']), null);
  assert.equal(await readHomeRouter(routerBinding({}), lan, ['http://192.168.1.1/d.xml']), null);
  assert.equal(await readHomeRouter(routerBinding({}), lan, []), null);
});

test('post-scan sync sends only the home, never share or the switches', () => {
  const home = { networkId: 'n', gatewayIp: '192.168.1.1', label: 'Home', routerId: 'uuid:r', routerUrl: 'http://192.168.1.1:5000/old.xml' };
  const router = { routerId: 'uuid:r', routerUrl: 'http://192.168.1.1:5000/new.xml' };
  const latest = { ...DEFAULT_HOME_WATCH_SETTINGS, whoIsHome: true, share: false, home };
  assert.deepEqual(postScanSyncHome(latest, router, 'Flat 4'), { ...home, label: 'Flat 4', routerUrl: router.routerUrl });
  assert.equal(postScanSyncHome({ ...latest, whoIsHome: false }, router, null), null, 'both switches off: nothing is saved');
  assert.equal(postScanSyncHome({ ...latest, home: null }, router, null), null);
  assert.equal(postScanSyncHome(null, router, null), null);
  assert.equal(postScanSyncHome(latest, { ...router, routerId: 'uuid:other' }, null), null, 'another router is not home');
});

function gatedBinding() {
  const order: string[] = [];
  const gates: Array<() => void> = [];
  const status = (tag: string) => ({ supported: false as const, tag });
  const call = (name: string) => () => {
    order.push(`start ${name}`);
    return new Promise<never>((resolve) => gates.push(() => { order.push(`end ${name}`); resolve(status(name) as never); }));
  };
  const binding = { getHomeWatch: call('get'), setHomeWatch: call('set'), syncHome: call('sync'), markDeviceMine: call('mine') };
  return { binding, order, release: async () => { gates.shift()?.(); await new Promise((r) => setImmediate(r)); } };
}

test('save queue: a call starts only after the one before it has finished, in the order made', async () => {
  const { binding, order, release } = gatedBinding();
  const queue = orderHomeWatch(binding);
  const home = { networkId: 'n', gatewayIp: '192.168.1.1', label: 'Home', routerId: 'uuid:r', routerUrl: 'u' };
  const sync = queue.syncHome(home, { people: [], known: [] });
  const off = queue.setHomeWatch(DEFAULT_HOME_WATCH_SETTINGS, null);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['start sync']);
  await release();
  assert.deepEqual(order, ['start sync', 'end sync', 'start set']);
  await release();
  await Promise.all([sync, off]);
  assert.deepEqual(order, ['start sync', 'end sync', 'start set', 'end set']);
});

test('save queue: an answer older than a call made after it is dropped, a failed call does not block the next', async () => {
  const stale = orderHomeWatch({
    getHomeWatch: async () => ({ supported: false }),
    setHomeWatch: async () => ({ supported: false }),
    syncHome: async () => { throw new Error('native failed'); },
    markDeviceMine: async () => ({ supported: false }),
  });
  const home = { networkId: 'n', gatewayIp: '192.168.1.1', label: 'Home', routerId: 'uuid:r', routerUrl: 'u' };
  const first = stale.getHomeWatch();
  const second = stale.setHomeWatch(DEFAULT_HOME_WATCH_SETTINGS, null);
  assert.equal(await first, null);
  assert.deepEqual(await second, { supported: false });
  await assert.rejects(stale.syncHome(home, { people: [], known: [] }), /native failed/);
  assert.deepEqual(await stale.markDeviceMine('192.168.1.2'), { supported: false });
});
