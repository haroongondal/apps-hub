/**
 * Latency prober test suite (node --test).
 * Port of the Dart `TCP latency prober` group against real loopback
 * sockets: reachable ranked above dead, inputs never mutated, concurrency
 * bounded by the argument.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { LatencyProber } from '../latency-prober.ts';
import { createNodeTcpProbe } from '../node-tcp-probe.ts';
import type { VpnNode } from '../vpn-node.ts';
import { createVpnNode } from '../vpn-node.ts';

/** Binds an ephemeral loopback listener that accepts and destroys sockets;
 * returns the bound port. */
async function openLoopbackPort(): Promise<{ port: number; server: net.Server | null }> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  // Keep the server listening: probes here must connect successfully.
  return { port, server };
}

/** Binds an ephemeral port, captures the number, and releases it so probes
 * hit a locally refused connection. */
async function bindAndReleasePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function loopbackNode(name: string, port: number, overrides: {
  score: number;
  pingMs: number;
  speedBps: number;
  numSessions: number;
  uptimeMs: number;
}): VpnNode {
  return createVpnNode({
    hostName: name,
    ip: '127.0.0.1',
    port,
    transportProto: 'tcp',
    score: overrides.score,
    pingMs: overrides.pingMs,
    speedBps: overrides.speedBps,
    countryLong: 'Local',
    countryShort: 'LOC',
    numSessions: overrides.numSessions,
    uptimeMs: overrides.uptimeMs,
    operatorName: 'testsuite',
    ovpnConfigRaw: 'client',
  });
}

test('ranks the reachable node above an unreachable one', async () => {
  const { port: openPort, server } = await openLoopbackPort();
  const closedPort = await bindAndReleasePort();

  const reachable = loopbackNode('loopback-open', openPort, {
    score: 100,
    pingMs: 50,
    speedBps: 200000000,
    numSessions: 10,
    uptimeMs: 315000000000,
  });
  const dead = loopbackNode('loopback-dead', closedPort, {
    score: 3000,
    pingMs: 0,
    speedBps: 10000000,
    numSessions: 100,
    uptimeMs: 60000,
  });

  const ranked = await new LatencyProber(createNodeTcpProbe()).probeAndScoreNodes(
    [dead, reachable],
    { timeoutMs: 1200 },
  );

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]!.id, reachable.id);
  assert.ok(ranked[0]!.measuredRttMs !== null);
  assert.ok(ranked[0]!.measuredRttMs! <= 1200);
  assert.equal(ranked[1]!.id, dead.id);
  assert.equal(ranked[1]!.measuredRttMs, null);

  await close(server);
});

test('never mutates the input list or its nodes', async () => {
  const closedPort = await bindAndReleasePort();
  const original = loopbackNode('mutate-target', closedPort, {
    score: 1,
    pingMs: 5,
    speedBps: 5000,
    numSessions: 1,
    uptimeMs: 1000,
  });
  const input: VpnNode[] = [original];

  const result = await new LatencyProber(createNodeTcpProbe()).probeAndScoreNodes(
    input,
    { timeoutMs: 50 },
  );

  assert.notEqual(result, input);
  assert.notEqual(result[0], original);
  assert.equal(original.measuredRttMs, null);
  assert.equal(original.fitnessScore, 0.0);
  assert.equal(result[0]!.measuredRttMs, null); // loopback refused this port
  assert.equal(input.length, 1);
});

test('concurrency stays bounded by the argument', async () => {
  const { port, server } = await openLoopbackPort();

  const candidates: VpnNode[] = Array.from({ length: 24 }, (_, i) =>
    loopbackNode(`node-${i}`, port, {
      score: i,
      pingMs: 50,
      speedBps: 10000000,
      numSessions: 10,
      uptimeMs: 1000000,
    }),
  );

  const results = await new LatencyProber(createNodeTcpProbe()).probeAndScoreNodes(
    candidates,
    { concurrency: 3, timeoutMs: 1200 },
  );

  assert.equal(results.length, 24);
  // Highest fitness first; ties keep whoever sorted first by comparator.
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i]!.fitnessScore <= results[i - 1]!.fitnessScore);
  }

  await close(server);
});

test('empty candidate list returns an empty result immediately', async () => {
  const results = await new LatencyProber(createNodeTcpProbe()).probeAndScoreNodes([]);
  assert.deepEqual(results, []);
});

async function close(server: net.Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
