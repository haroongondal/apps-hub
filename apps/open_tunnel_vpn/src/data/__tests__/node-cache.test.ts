/**
 * Local node-cache test suite (node --test).
 * Port of the Dart `vpngate_cache_test.dart` — same assertions against the
 * same SQL semantics, executed on Node's built-in SQLite engine (not a
 * mock) through the app's real repository code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
  createVpnNode,
  withProbe,
  type VpnNode,
} from 'open-tunnel-core';
import { VpnNodeCache } from '../node-cache.ts';
import { nodeSqliteDriver } from '../sqlite-driver.ts';

/** Every suite runs against its own in-memory engine; the statements under
 * test are identical to the on-device expo-sqlite path. */
function openCache(): VpnNodeCache {
  return new VpnNodeCache(nodeSqliteDriver(DatabaseSync)(':memory:'));
}

function fixtureNode(overrides: {
  host: string;
  ip: string;
  port: number;
  countryCode?: string;
  fitness: number;
  measuredRttMs?: number | null;
}): VpnNode {
  const base = createVpnNode({
    hostName: overrides.host,
    ip: overrides.ip,
    port: overrides.port,
    transportProto: 'udp',
    score: 100,
    pingMs: 20,
    speedBps: 50000000,
    countryLong: overrides.countryCode === 'US' ? 'United States' : 'Japan',
    countryShort: overrides.countryCode ?? 'JP',
    numSessions: 10,
    uptimeMs: 315000000000,
    operatorName: 'testsuite',
    ovpnConfigRaw: 'client\ndata-ciphers AES-256-GCM\n',
  });
  return withProbe(base, {
    measuredRttMs: overrides.measuredRttMs ?? null,
    fitnessScore: overrides.fitness,
  });
}

test('round-trips every mapped field, including probe results', async () => {
  const cache = openCache();
  const tokyo = fixtureNode({ host: 'tokyo-relay', ip: '219.100.37.110', port: 1195, fitness: 131.9, measuredRttMs: 42 });
  const fresno = fixtureNode({ host: 'fresno-relay', ip: '203.0.113.77', port: 443, countryCode: 'US', fitness: 42.5 });

  await cache.replaceAllNodes([tokyo, fresno]);
  const rows = await cache.loadNodes({ withConfig: true });

  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.id, tokyo.id, 'ordered by stored fitness');
  assert.equal(rows[0]!.hostName, 'tokyo-relay');
  assert.equal(rows[0]!.port, 1195);
  assert.equal(rows[0]!.countryShort, 'JP');
  assert.equal(rows[0]!.transportProto, 'udp');
  assert.equal(rows[0]!.protocol, 'openvpn');
  assert.match(rows[0]!.ovpnConfigRaw, /data-ciphers/);
  // Probe state survives the cache round trip (improvement over the Drift
  // restore behavior — see the note in node-cache.ts).
  assert.equal(rows[0]!.measuredRttMs, 42);
  assert.ok(Math.abs(rows[0]!.fitnessScore - 131.9) < 1e-9);
  assert.equal(rows[1]!.countryShort, 'US');
});

test('list reads come back configless and ranked by stored fitness', async () => {
  const cache = openCache();
  const low = fixtureNode({ host: 'low', ip: '203.0.113.5', port: 1, countryCode: 'US', fitness: 3.0 });
  const high = fixtureNode({ host: 'high', ip: '203.0.113.6', port: 2, fitness: 99.0 });

  await cache.replaceAllNodes([low, high]);
  const rows = await cache.loadNodes();

  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.hostName, 'high');
  assert.equal(rows[1]!.hostName, 'low');
  assert.ok(
    rows.every((row) => row.ovpnConfigRaw === ''),
    'list reads keep the tunnel payload out of the UI',
  );
});

test('country filter is case-insensitive', async () => {
  const cache = openCache();
  const jp = fixtureNode({ host: 'jp-relay', ip: '219.100.37.110', port: 1195, fitness: 131.9 });
  const us = fixtureNode({ host: 'us-relay', ip: '203.0.113.77', port: 443, countryCode: 'US', fitness: 1.0 });

  await cache.replaceAllNodes([jp, us]);
  const japanese = await cache.loadNodes({ countryCode: 'jp' });

  assert.equal(japanese.length, 1);
  assert.equal(japanese[0]!.hostName, 'jp-relay');
});

test('a refresh evicts every relay missing from the new list', async () => {
  const cache = openCache();
  const tokyo = fixtureNode({ host: 'tokyo', ip: '219.100.37.110', port: 1195, fitness: 8.0 });
  const fresno = fixtureNode({ host: 'fresno', ip: '203.0.113.77', port: 443, countryCode: 'US', fitness: 5.0 });

  await cache.replaceAllNodes([tokyo, fresno]);
  assert.equal((await cache.loadNodes()).length, 2);

  await cache.replaceAllNodes([tokyo]);
  const afterRefresh = await cache.loadNodes();
  assert.equal(afterRefresh.length, 1);
  assert.equal(afterRefresh[0]!.hostName, 'tokyo');

  await cache.replaceAllNodes([]);
  assert.deepEqual(await cache.loadNodes(), []);
});

test('limit bounds the returned rows, highest fitness first', async () => {
  const cache = openCache();
  const nodes = [
    fixtureNode({ host: 'a', ip: '203.0.113.1', port: 1, fitness: 3 }),
    fixtureNode({ host: 'b', ip: '203.0.113.2', port: 2, fitness: 5 }),
    fixtureNode({ host: 'c', ip: '203.0.113.3', port: 3, fitness: 9 }),
  ];
  await cache.replaceAllNodes(nodes);
  const rows = await cache.loadNodes({ limit: 2 });
  assert.equal(rows.length, 2);
  assert.ok(rows[0]!.fitnessScore >= rows[1]!.fitnessScore);
});

test('open() is idempotent; a second open keeps querying the same cache', async () => {
  const cache = openCache();
  const node = fixtureNode({ host: 'stable', ip: '203.0.113.9', port: 9, fitness: 1 });
  await cache.replaceAllNodes([node]);
  await cache.open(); // second open must not recreate or fail
  const rows = await cache.loadNodes();
  assert.equal(rows.length, 1);
});

test('identity persists as the sha256 endpoint key', async () => {
  const cache = openCache();
  const node = fixtureNode({ host: 'x', ip: '203.0.113.10', port: 10, fitness: 7 });
  await cache.replaceAllNodes([node]);
  const rows = await cache.loadNodes();
  assert.equal(
    rows[0]!.id,
    crypto.createHash('sha256').update('203.0.113.10:10').digest('hex'),
  );
});
